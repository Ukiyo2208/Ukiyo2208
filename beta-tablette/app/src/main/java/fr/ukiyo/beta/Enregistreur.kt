package fr.ukiyo.beta

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Enregistre la phrase prononcée après « Hey Bêta » et s'arrête tout seul quand on se tait.
 * Détection de voix simple, basée sur le volume par rapport au bruit ambiant.
 */
class Enregistreur(private val bruitAmbiant: Float) {
    companion object {
        const val FREQUENCE = 16000
        private const val MS_PAR_BLOC = 80
        private const val SILENCE_FIN_MS = 900
        private const val ATTENTE_MAX_MS = 4000
        private const val DUREE_MAX_MS = 10000
        private const val BLOCS_IGNORES = 3 // le « bip » de début d'écoute
        private const val VOLUME_MIN = 400f

        fun volume(bloc: ShortArray): Float {
            var somme = 0.0
            for (s in bloc) somme += s.toDouble() * s
            return sqrt(somme / bloc.size).toFloat()
        }
    }

    enum class Etat { EN_COURS, TERMINE, RIEN_ENTENDU }

    private val pcm = ByteArrayOutputStream()
    private val seuil = max(bruitAmbiant * 2.5f, VOLUME_MIN)
    private var blocs = 0
    private var paroleEntendue = false
    private var silenceMs = 0

    /** Ajoute un bloc de micro et dit si la phrase est finie. */
    fun ajouter(bloc: ShortArray): Etat {
        blocs++
        if (blocs <= BLOCS_IGNORES) return Etat.EN_COURS

        val octets = ByteBuffer.allocate(bloc.size * 2).order(ByteOrder.LITTLE_ENDIAN)
        bloc.forEach { octets.putShort(it) }
        pcm.write(octets.array())

        val dureeMs = blocs * MS_PAR_BLOC
        if (volume(bloc) > seuil) {
            paroleEntendue = true
            silenceMs = 0
        } else {
            silenceMs += MS_PAR_BLOC
        }

        return when {
            !paroleEntendue && dureeMs >= ATTENTE_MAX_MS -> Etat.RIEN_ENTENDU
            paroleEntendue && silenceMs >= SILENCE_FIN_MS -> Etat.TERMINE
            dureeMs >= DUREE_MAX_MS -> if (paroleEntendue) Etat.TERMINE else Etat.RIEN_ENTENDU
            else -> Etat.EN_COURS
        }
    }

    /** La phrase au format WAV 16 kHz, mono, 16 bits (ce qu'attend le NAS). */
    fun wav(): ByteArray {
        val donnees = pcm.toByteArray()
        val entete = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + donnees.size); put("WAVE".toByteArray())
            put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
            putInt(FREQUENCE); putInt(FREQUENCE * 2); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(donnees.size)
        }
        return entete.array() + donnees
    }
}
