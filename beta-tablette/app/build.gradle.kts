import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "fr.ukiyo.beta"
    compileSdk = 34

    defaultConfig {
        applicationId = "fr.ukiyo.beta"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1"
        // Les tablettes Android récentes sont en ARM ; ça divise la taille de l'APK par ~3
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signée avec la clé de debug pour pouvoir l'installer directement
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }

    // Les modèles .onnx sont déjà compressés : inutile de perdre du temps à les recompresser
    androidResources { noCompress += "onnx" }
}

dependencies {
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")
    implementation("org.opencv:opencv:4.10.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}

// Télécharge les modèles (wake word, YuNet, SFace) la première fois, au lieu de les stocker dans Git
val modeles = mapOf(
    "melspectrogram.onnx" to "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.onnx",
    "embedding_model.onnx" to "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.onnx",
    "wakeword.onnx" to "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/hey_jarvis_v0.1.onnx",
    "face_detection_yunet_2023mar.onnx" to
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "face_recognition_sface_2021dec.onnx" to
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
)

val telechargerModeles by tasks.registering {
    val dossier = layout.projectDirectory.dir("src/main/assets/modeles")
    outputs.dir(dossier)
    doLast {
        dossier.asFile.mkdirs()
        modeles.forEach { (nom, url) ->
            val fichier = dossier.file(nom).asFile
            if (!fichier.exists() || fichier.length() < 10_000) {
                logger.lifecycle("Téléchargement de $nom")
                URI(url).toURL().openStream().use { entree -> fichier.outputStream().use { entree.copyTo(it) } }
            }
        }
    }
}

tasks.named("preBuild") { dependsOn(telechargerModeles) }
