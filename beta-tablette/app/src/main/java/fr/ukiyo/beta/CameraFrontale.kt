@file:Suppress("DEPRECATION") // android.hardware.Camera : simple, sans AndroidX, et marche sur toutes les tablettes

package fr.ukiyo.beta

import android.graphics.ImageFormat
import android.graphics.SurfaceTexture
import android.hardware.Camera
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.imgproc.Imgproc
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * Caméra frontale qui livre des images BGR « à l'endroit » à OpenCV.
 * Les images sont traitées une par une sur un thread dédié (les suivantes sont ignorées pendant ce temps).
 */
class CameraFrontale(
    /** Rotation de l'écran en degrés (0, 90, 180, 270) */
    private val rotationEcran: () -> Int,
    /** Rotation forcée de l'image en degrés, ou -1 pour la calculer automatiquement */
    private val rotationForcee: Int = -1,
) {
    private var thread: HandlerThread? = null
    private var camera: Camera? = null
    private var textureInterne: SurfaceTexture? = null

    /** Ouvre la caméra ; [surImage] est appelé pour chaque image traitée. Retourne false si impossible. */
    fun demarrer(apercu: SurfaceTexture? = null, surImage: (Mat) -> Unit): Boolean {
        arreter()
        val t = HandlerThread("camera-beta").apply { start() }
        thread = t
        val pret = CountDownLatch(1)
        var ok = false
        // Les images arrivent sur le thread qui a ouvert la caméra
        Handler(t.looper).post {
            try {
                ok = ouvrir(apercu, surImage)
            } catch (e: RuntimeException) {
                Log.e("Beta", "Caméra indisponible", e)
            } finally {
                pret.countDown()
            }
        }
        pret.await(5, TimeUnit.SECONDS)
        if (!ok) arreter()
        return ok
    }

    private fun ouvrir(apercu: SurfaceTexture?, surImage: (Mat) -> Unit): Boolean {
        val infos = Camera.CameraInfo()
        val id = (0 until Camera.getNumberOfCameras()).firstOrNull {
            Camera.getCameraInfo(it, infos)
            infos.facing == Camera.CameraInfo.CAMERA_FACING_FRONT
        } ?: return false
        Camera.getCameraInfo(id, infos)

        val cam = Camera.open(id)
        camera = cam
        val params = cam.parameters
        val taille = params.supportedPreviewSizes.minBy { abs(it.width * it.height - 640 * 480) }
        params.setPreviewSize(taille.width, taille.height)
        params.previewFormat = ImageFormat.NV21
        cam.parameters = params

        val rotation = if (rotationForcee >= 0) rotationForcee else (infos.orientation + rotationEcran()) % 360
        if (apercu != null) {
            // L'aperçu de la caméra frontale est affiché en miroir par Android
            cam.setDisplayOrientation((360 - rotation) % 360)
            cam.setPreviewTexture(apercu)
        } else {
            textureInterne = SurfaceTexture(42).also { cam.setPreviewTexture(it) }
        }

        val largeur = taille.width
        val hauteur = taille.height
        val yuv = Mat(hauteur * 3 / 2, largeur, CvType.CV_8UC1)
        val bgr = Mat()
        val tampon = ByteArray(largeur * hauteur * 3 / 2)
        cam.setPreviewCallbackWithBuffer { donnees, c ->
            try {
                yuv.put(0, 0, donnees)
                Imgproc.cvtColor(yuv, bgr, Imgproc.COLOR_YUV2BGR_NV21)
                when (rotation) {
                    90 -> Core.rotate(bgr, bgr, Core.ROTATE_90_CLOCKWISE)
                    180 -> Core.rotate(bgr, bgr, Core.ROTATE_180)
                    270 -> Core.rotate(bgr, bgr, Core.ROTATE_90_COUNTERCLOCKWISE)
                }
                surImage(bgr)
            } catch (e: Exception) {
                Log.w("Beta", "Image ignorée", e)
            } finally {
                c.addCallbackBuffer(donnees)
            }
        }
        cam.addCallbackBuffer(tampon)
        cam.startPreview()
        return true
    }

    fun arreter() {
        val t = thread ?: return
        val fini = CountDownLatch(1)
        Handler(t.looper).post {
            camera?.run {
                setPreviewCallbackWithBuffer(null)
                stopPreview()
                release()
            }
            camera = null
            textureInterne?.release()
            textureInterne = null
            fini.countDown()
        }
        fini.await(3, TimeUnit.SECONDS)
        t.quitSafely()
        thread = null
    }
}
