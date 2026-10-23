package fr.ukiyo.beta

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.ProgressBar
import fr.ukiyo.beta.Etat.Phase
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Écran principal, prévu pour rester allumé sur la tablette. */
class MainActivity : Activity() {
    private val scope = MainScope()
    private var suivi: Job? = null
    private lateinit var reglages: Reglages

    private lateinit var icone: android.widget.TextView
    private lateinit var message: android.widget.TextView
    private lateinit var personne: android.widget.TextView
    private lateinit var dit: android.widget.TextView
    private lateinit var reponse: android.widget.TextView
    private lateinit var niveau: ProgressBar
    private lateinit var pause: android.widget.Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        reglages = Reglages(this)

        icone = texte("", 72f).apply { gravity = Gravity.CENTER }
        message = texte("", 28f, gras = true).apply { gravity = Gravity.CENTER }
        personne = texte("", 18f, ACCENT).apply { gravity = Gravity.CENTER }
        dit = texte("", 18f, TEXTE_DOUX)
        reponse = texte("", 22f)
        niveau = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100 }
        pause = bouton("Pause") { basculerPause() }

        setContentView(
            defilable(
                colonne(
                    32,
                    icone, message, personne, niveau, dit, reponse,
                    ligne(
                        pause,
                        bouton("Visages") { startActivity(Intent(this, VisagesActivity::class.java)) },
                        bouton("Réglages") { startActivity(Intent(this, ReglagesActivity::class.java)) },
                    ),
                ),
            ),
        )
    }

    override fun onStart() {
        super.onStart()
        suivi = scope.launch { Etat.affichage.collect { afficher(it) } }
        if (!reglages.estConfigure) {
            startActivity(Intent(this, ReglagesActivity::class.java))
        } else if (demanderPermissions()) {
            BetaService.demarrer(this)
        }
    }

    override fun onStop() {
        suivi?.cancel()
        super.onStop()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    /** Retourne true si tout est déjà autorisé. */
    private fun demanderPermissions(): Boolean {
        val voulues = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            add(Manifest.permission.CAMERA)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        val manquantes = voulues.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (manquantes.isEmpty()) return true
        requestPermissions(manquantes.toTypedArray(), 1)
        return false
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            BetaService.demarrer(this)
        } else {
            Etat.maj { it.copy(phase = Phase.ERREUR, message = "Bêta a besoin du micro pour fonctionner") }
        }
    }

    private fun basculerPause() {
        if (Etat.affichage.value.phase == Phase.ARRET) {
            BetaService.demarrer(this)
        } else {
            BetaService.arreter(this)
        }
    }

    private fun afficher(a: Etat.Affichage) {
        icone.text = when (a.phase) {
            Phase.ARRET -> "⏸"
            Phase.ECOUTE -> "👂"
            Phase.COMMANDE -> "🎙"
            Phase.ENVOI -> "💭"
            Phase.REPONSE -> "💬"
            Phase.ERREUR -> "⚠️"
        }
        message.text = a.message
        personne.text = a.personne?.let { if (it == "inconnu") "Visage non reconnu" else "Bonjour $it" } ?: ""
        niveau.progress = (a.scoreWakeWord * 100).toInt()
        dit.text = if (a.texteReconnu.isNotEmpty()) "Tu as dit : « ${a.texteReconnu} »" else ""
        reponse.text = a.reponse
        pause.text = if (a.phase == Phase.ARRET) "Reprendre" else "Pause"
    }
}
