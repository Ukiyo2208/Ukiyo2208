package fr.ukiyo.beta

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.FloatBuffer

/**
 * Détection du mot d'activation avec openWakeWord (mêmes calculs que la version Python).
 *
 * Chaque bloc de 80 ms (1280 échantillons à 16 kHz) donne 8 trames de mel-spectrogramme,
 * puis un vecteur de 96 valeurs ; le modèle du mot d'activation regarde les 16 derniers vecteurs.
 */
class WakeWord(melspec: ByteArray, embedding: ByteArray, motCle: ByteArray) : AutoCloseable {
    companion object {
        const val TAILLE_BLOC = 1280
        private const val CONTEXTE = 160 * 3
        private const val TRAMES_MEL = 76
        private const val NB_MEL = 32
        private const val TAILLE_EMBEDDING = 96
        private const val NB_EMBEDDINGS = 16
        private const val MAX_TRAMES_MEL = 120
        private const val PREDICTIONS_IGNOREES = 5
    }

    private val env = OrtEnvironment.getEnvironment()
    private val options = OrtSession.SessionOptions().apply { setIntraOpNumThreads(1) }
    private val melSession = env.createSession(melspec, options)
    private val embSession = env.createSession(embedding, options)
    private val motSession = env.createSession(motCle, options)

    private val audio = FloatArray(TAILLE_BLOC + CONTEXTE)
    private val mel = ArrayDeque<FloatArray>()
    private val embeddings = ArrayDeque<FloatArray>()
    private var predictions = 0

    init {
        reinitialiser()
    }

    /** Oublie tout ce qui a été entendu (après une réponse, pour ne pas se redéclencher). */
    fun reinitialiser() {
        audio.fill(0f)
        mel.clear()
        repeat(TRAMES_MEL) { mel.addLast(FloatArray(NB_MEL) { 1f }) }
        embeddings.clear()
        predictions = 0
    }

    /** Ajoute 1280 échantillons 16 bits et retourne le score du mot d'activation (0 à 1). */
    fun traiter(bloc: ShortArray): Float {
        require(bloc.size == TAILLE_BLOC) { "Bloc de ${bloc.size} échantillons au lieu de $TAILLE_BLOC" }

        // Fenêtre glissante : les 480 derniers échantillons du bloc précédent + le nouveau bloc
        System.arraycopy(audio, TAILLE_BLOC, audio, 0, CONTEXTE)
        for (i in bloc.indices) audio[CONTEXTE + i] = bloc[i].toFloat()

        val spectre = executer(melSession, audio, longArrayOf(1, audio.size.toLong()))
        for (t in 0 until spectre.size / NB_MEL) {
            mel.addLast(FloatArray(NB_MEL) { spectre[t * NB_MEL + it] / 10f + 2f })
        }
        while (mel.size > MAX_TRAMES_MEL) mel.removeFirst()

        val fenetre = FloatArray(TRAMES_MEL * NB_MEL)
        val debut = mel.size - TRAMES_MEL
        for (t in 0 until TRAMES_MEL) System.arraycopy(mel[debut + t], 0, fenetre, t * NB_MEL, NB_MEL)
        val emb = executer(embSession, fenetre, longArrayOf(1, TRAMES_MEL.toLong(), NB_MEL.toLong(), 1))
        embeddings.addLast(emb.copyOf(TAILLE_EMBEDDING))
        while (embeddings.size > NB_EMBEDDINGS) embeddings.removeFirst()

        if (embeddings.size < NB_EMBEDDINGS) return 0f
        val entree = FloatArray(NB_EMBEDDINGS * TAILLE_EMBEDDING)
        embeddings.forEachIndexed { i, e -> System.arraycopy(e, 0, entree, i * TAILLE_EMBEDDING, TAILLE_EMBEDDING) }
        val score = executer(motSession, entree, longArrayOf(1, NB_EMBEDDINGS.toLong(), TAILLE_EMBEDDING.toLong()))[0]

        // Comme openWakeWord : les toutes premières prédictions ne sont pas fiables
        predictions++
        return if (predictions <= PREDICTIONS_IGNOREES) 0f else score
    }

    private fun executer(session: OrtSession, donnees: FloatArray, forme: LongArray): FloatArray {
        OnnxTensor.createTensor(env, FloatBuffer.wrap(donnees), forme).use { tenseur ->
            session.run(mapOf(session.inputNames.first() to tenseur)).use { resultat ->
                val sortie = (resultat.get(0) as OnnxTensor).floatBuffer
                return FloatArray(sortie.remaining()).also { sortie.get(it) }
            }
        }
    }

    override fun close() {
        melSession.close()
        embSession.close()
        motSession.close()
        options.close()
    }
}
