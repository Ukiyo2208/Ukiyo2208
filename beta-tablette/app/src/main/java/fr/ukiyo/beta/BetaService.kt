package fr.ukiyo.beta

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.media.ToneGenerator
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import fr.ukiyo.beta.Etat.Phase
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.opencv.android.OpenCVLoader
import java.io.File
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume

/**
 * Tourne en continu : écoute « Hey Bêta », regarde qui parle, enregistre la commande,
 * l'envoie au NAS et lit la réponse.
 */
class BetaService : Service() {
    companion object {
        private const val TAG = "Beta"
        private const val CANAL = "beta"
        private const val DUREE_MAX_VISAGE_MS = 3000L
        private const val ATTENTE_VISAGE_APRES_PHRASE_MS = 500L
        /** Au-delà de seuil + marge, inutile de continuer à chercher un meilleur visage */
        private const val MARGE_VISAGE_SUR = 0.15f

        fun demarrer(context: Context) {
            // Sans le micro, Android refuse le service (et l'app planterait)
            if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return
            context.startForegroundService(Intent(context, BetaService::class.java))
        }

        fun arreter(context: Context) {
            context.stopService(Intent(context, BetaService::class.java))
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var reglages: Reglages
    private lateinit var client: ClientNas
    private lateinit var camera: CameraFrontale
    private var wakeWord: WakeWord? = null
    private var visages: Visages? = null
    private var verrou: PowerManager.WakeLock? = null
    private val bip = ToneGenerator(AudioManager.STREAM_MUSIC, 80)

    @Volatile private var phase = Phase.ARRET
    private var enregistreur: Enregistreur? = null
    private var identification: Deferred<Unit>? = null
    /** Meilleur visage vu depuis « Hey Bêta » (mis à jour image par image par la caméra) */
    private val meilleurVisage = AtomicReference(Visages.Identification(null, 0f))
    private var bruitAmbiant = 300f

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        reglages = Reglages(this)
        client = ClientNas(reglages)
        camera = CameraFrontale({ rotationEcran(this) }, reglages.rotationCamera)
        demarrerPremierPlan()

        verrou = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "beta:ecoute")
            .apply { acquire() }

        scope.launch(Dispatchers.IO) {
            try {
                OpenCVLoader.initLocal()
                visages = Modeles.visages(this@BetaService)
                wakeWord = WakeWord(
                    Modeles.octets(this@BetaService, Modeles.MELSPEC),
                    Modeles.octets(this@BetaService, Modeles.EMBEDDING),
                    Modeles.octetsWakeWord(this@BetaService),
                )
            } catch (e: Exception) {
                Log.e(TAG, "Chargement des modèles impossible", e)
                afficherErreur("Modèles introuvables : ${e.message}")
                return@launch
            }
            boucleMicro()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

    override fun onDestroy() {
        phase = Phase.ARRET
        scope.cancel()
        camera.arreter()
        bip.release()
        verrou?.release()
        Etat.maj { Etat.Affichage(phase = Phase.ARRET, message = "En pause") }
        super.onDestroy()
    }

    // ---------------------------------------------------------------- Micro

    private suspend fun boucleMicro() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            afficherErreur("Autorise le micro pour Bêta")
            return
        }
        val tailleMin = AudioRecord.getMinBufferSize(
            Enregistreur.FREQUENCE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
        )
        val micro = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            Enregistreur.FREQUENCE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(tailleMin, WakeWord.TAILLE_BLOC * 2 * 8),
        )
        if (micro.state != AudioRecord.STATE_INITIALIZED) {
            afficherErreur("Micro indisponible")
            return
        }

        val wake = wakeWord!!
        val bloc = ShortArray(WakeWord.TAILLE_BLOC)
        micro.startRecording()
        passerEnEcoute()
        try {
            while (scope.isActive) {
                var lus = 0
                while (lus < bloc.size) {
                    val n = micro.read(bloc, lus, bloc.size - lus)
                    if (n < 0) throw IllegalStateException("Lecture du micro impossible ($n)")
                    lus += n
                }
                when (phase) {
                    Phase.ECOUTE -> {
                        bruitAmbiant = 0.95f * bruitAmbiant + 0.05f * Enregistreur.volume(bloc)
                        val score = wake.traiter(bloc)
                        Etat.maj { it.copy(scoreWakeWord = score) }
                        if (score >= reglages.seuilWakeWord) motCleEntendu()
                    }
                    Phase.COMMANDE -> when (enregistreur?.ajouter(bloc)) {
                        Enregistreur.Etat.TERMINE -> commandeTerminee()
                        Enregistreur.Etat.RIEN_ENTENDU -> rienEntendu()
                        else -> Unit
                    }
                    else -> Unit // pendant l'envoi et la réponse, on n'écoute pas
                }
            }
        } finally {
            micro.stop()
            micro.release()
            wake.close()
        }
    }

    // ---------------------------------------------------------------- Étapes

    private fun passerEnEcoute() {
        wakeWord?.reinitialiser()
        enregistreur = null
        phase = Phase.ECOUTE
        Etat.maj { it.copy(phase = Phase.ECOUTE, message = "Dis « Hey Bêta »", scoreWakeWord = 0f) }
    }

    private fun motCleEntendu() {
        phase = Phase.COMMANDE
        enregistreur = Enregistreur(bruitAmbiant)
        bip.startTone(ToneGenerator.TONE_PROP_BEEP, 150)
        Etat.maj { it.copy(phase = Phase.COMMANDE, message = "Je t'écoute…", personne = null) }
        meilleurVisage.set(Visages.Identification(null, 0f))
        identification = scope.async(Dispatchers.IO) { reconnaitreVisage() }
    }

    private fun rienEntendu() {
        identification?.cancel() // la caméra est fermée par reconnaitreVisage
        passerEnEcoute()
    }

    private fun commandeTerminee() {
        phase = Phase.ENVOI
        val wav = enregistreur!!.wav()
        val visage = identification
        Etat.maj { it.copy(phase = Phase.ENVOI, message = "Je réfléchis…") }

        scope.launch(Dispatchers.IO) {
            try {
                // Le visage ne sert qu'à personnaliser : on ne fait pas attendre une commande domotique
                withTimeoutOrNull(ATTENTE_VISAGE_APRES_PHRASE_MS) { visage?.await() }
                visage?.cancel()
                val id = meilleurVisage.get()
                val personne = id.nom.takeIf { id.score >= reglages.seuilVisage }
                Etat.maj { it.copy(personne = personne) }

                if (!reglages.estConfigure) throw ClientNas.ErreurNas("Renseigne l'adresse du NAS dans les réglages")
                val reponse = client.envoyer(wav, personne, id.score)
                phase = Phase.REPONSE
                Etat.maj {
                    it.copy(
                        phase = Phase.REPONSE,
                        message = "",
                        texteReconnu = reponse.texteReconnu,
                        reponse = reponse.reponse,
                    )
                }
                reponse.audioWav?.let { lire(it) }
            } catch (e: Exception) {
                Log.e(TAG, "Échec de la commande", e)
                afficherErreur(e.message ?: "Le NAS ne répond pas")
                delay(3000)
            } finally {
                passerEnEcoute()
            }
        }
    }

    private suspend fun reconnaitreVisage() {
        val v = visages ?: return
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return
        val meilleur = meilleurVisage
        val suffisant = CompletableDeferred<Unit>()
        val ouverte = camera.demarrer { image ->
            if (suffisant.isCompleted) return@demarrer
            val empreinte = v.empreinte(image) ?: return@demarrer
            val id = v.identifier(empreinte)
            if (id.score > meilleur.get().score) {
                meilleur.set(id)
                Etat.maj { it.copy(personne = id.nom.takeIf { id.score >= reglages.seuilVisage }) }
            }
            if (id.score >= reglages.seuilVisage + MARGE_VISAGE_SUR) suffisant.complete(Unit)
        }
        if (ouverte) {
            try {
                withTimeoutOrNull(DUREE_MAX_VISAGE_MS) { suffisant.await() }
            } finally {
                camera.arreter()
            }
        }
    }

    private suspend fun lire(wav: ByteArray) {
        val fichier = File(cacheDir, "reponse.wav").apply { writeBytes(wav) }
        val lecteur = MediaPlayer()
        try {
            lecteur.setDataSource(fichier.absolutePath)
            lecteur.prepare()
            suspendCancellableCoroutine { suite ->
                lecteur.setOnCompletionListener { if (suite.isActive) suite.resume(Unit) }
                lecteur.setOnErrorListener { _, _, _ -> if (suite.isActive) suite.resume(Unit); true }
                suite.invokeOnCancellation { lecteur.stop() }
                lecteur.start()
            }
        } finally {
            lecteur.release()
        }
    }

    private fun afficherErreur(message: String) {
        Etat.maj { it.copy(phase = Phase.ERREUR, message = message) }
    }

    // ---------------------------------------------------------------- Notification

    private fun demarrerPremierPlan() {
        val gestionnaire = getSystemService(NotificationManager::class.java)
        gestionnaire.createNotificationChannel(
            NotificationChannel(CANAL, "Bêta à l'écoute", NotificationManager.IMPORTANCE_LOW),
        )
        val ouvrir = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(this, CANAL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Bêta est à l'écoute")
            .setContentText("Dis « Hey Bêta »")
            .setContentIntent(ouvrir)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            }
            startForeground(1, notification, types)
        } else {
            startForeground(1, notification)
        }
    }
}
