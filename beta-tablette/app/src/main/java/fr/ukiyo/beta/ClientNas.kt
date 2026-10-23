package fr.ukiyo.beta

import android.util.Base64
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.Locale
import java.util.concurrent.TimeUnit

/** Envoie la commande au service Bêta du NAS (voir beta-nas/README.md, « API pour la tablette »). */
class ClientNas(private val reglages: Reglages) {
    // Une automatisation passe par l'IA web : la réponse peut prendre une trentaine de secondes
    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .build()

    data class Reponse(val texteReconnu: String, val reponse: String, val route: String, val audioWav: ByteArray?)

    class ErreurNas(message: String) : IOException(message)

    fun envoyer(wav: ByteArray, personne: String?, confiance: Float): Reponse {
        val corps = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("audio", "commande.wav", wav.toRequestBody("audio/wav".toMediaType()))
            .addFormDataPart("personne", personne ?: "")
            .addFormDataPart("confiance", String.format(Locale.US, "%.3f", confiance))
            .build()
        val requete = Request.Builder()
            .url("${reglages.urlNas}/v1/commande")
            .header("Authorization", "Bearer ${reglages.jeton}")
            .post(corps)
            .build()

        http.newCall(requete).execute().use { r ->
            val texte = r.body?.string().orEmpty()
            when {
                r.code == 401 -> throw ErreurNas("Jeton refusé par le NAS : vérifie les réglages")
                !r.isSuccessful -> throw ErreurNas("Erreur du NAS (${r.code}) : $texte")
            }
            val json = JSONObject(texte)
            val audio = json.optString("audio_wav_base64", "")
            return Reponse(
                texteReconnu = json.optString("texte_reconnu"),
                reponse = json.optString("reponse"),
                route = json.optString("route"),
                audioWav = if (audio.isEmpty() || audio == "null") null else Base64.decode(audio, Base64.DEFAULT),
            )
        }
    }

    /** Pour le bouton « Tester la connexion » des réglages. */
    fun tester(): String {
        val requete = Request.Builder().url("${reglages.urlNas}/sante").build()
        http.newCall(requete).execute().use { r ->
            if (!r.isSuccessful) throw ErreurNas("Le NAS répond ${r.code}")
            val json = JSONObject(r.body?.string().orEmpty())
            val ha = if (json.optBoolean("home_assistant")) "OK" else "injoignable"
            val web = if (json.optBoolean("ia_web")) "activée" else "désactivée"
            return "Bêta OK · Home Assistant $ha · IA web $web"
        }
    }
}
