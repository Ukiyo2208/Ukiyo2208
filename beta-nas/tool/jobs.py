"""File de tâches commune aux outils longs (compression vidéo, transcription…).

Chaque tâche a un dossier de travail ; le résultat reste téléchargeable
JOB_TTL_HOURS puis le dossier est supprimé."""

import os
import shutil
import threading
import time
import uuid
from collections import OrderedDict
from queue import Queue

import activity
from converter import WORK_DIR, ConvertError

JOB_TTL = float(os.environ.get("JOB_TTL_HOURS", "24")) * 3600
HIDDEN = ("work", "src", "result", "user", "options", "source")


class JobQueue:
    def __init__(self, tool, handler, workers=1, label="Tâche"):
        self.tool, self.handler, self.label = tool, handler, label
        self.jobs = OrderedDict()
        self.lock = threading.Lock()
        self.queue = Queue()
        self.workers = workers

    def update(self, job_id, **fields):
        with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id].update(fields)

    def submit(self, upload, options, user, title=None):
        """upload : fichier envoyé, ou converter.LocalFile pour un fichier du NAS."""
        from converter import sanitize_name
        job_id = uuid.uuid4().hex[:10]
        work = os.path.join(WORK_DIR, f"{self.tool}-{job_id}")
        os.makedirs(os.path.join(work, "in"))
        name = sanitize_name(upload.filename)
        src = os.path.join(work, "in", name)
        upload.save(src)
        with self.lock:
            self.jobs[job_id] = {"id": job_id, "name": name, "title": title or name, "status": "queued", "progress": None,
                                 "step": None, "error": None, "output": None, "size": None, "saved": None, "created": time.time(),
                                 "work": work, "src": src, "user": user, "options": options,
                                 "source": getattr(upload, "path", None)}
        self.queue.put(job_id)
        return job_id

    def list(self, user, role="member"):
        with self.lock:
            return [{k: v for k, v in j.items() if k not in HIDDEN} for j in reversed(self.jobs.values())
                    if j["user"] == user or role == "admin"]

    def get(self, job_id):
        with self.lock:
            return self.jobs.get(job_id)

    def result(self, job_id, user, role):
        j = self.get(job_id)
        if not j or (j["user"] != user and role != "admin") or not j.get("result") or not os.path.exists(j["result"]):
            return None
        return j

    def remove(self, job_id, user, role):
        with self.lock:
            j = self.jobs.get(job_id)
            if not j or (j["user"] != user and role != "admin"):
                raise ValueError("Tâche introuvable")
            if j["status"] in ("queued", "running"):
                raise ValueError("Tâche en cours : attends la fin")
            del self.jobs[job_id]
        shutil.rmtree(j["work"], ignore_errors=True)

    def _worker(self):
        while True:
            job_id = self.queue.get()
            job = self.get(job_id)
            if not job:
                continue
            self.update(job_id, status="running", started=time.time())
            try:
                out = self.handler(job, lambda **kw: self.update(job_id, **kw))
                self.update(job_id, status="done", progress=100, finished=time.time(), **(out or {}))
                activity.log(job["user"], self.tool, f"{self.label} terminée : {job['title']}", f"#/{self.tool}")
            except Exception as e:  # noqa: BLE001
                msg = str(e) if isinstance(e, (ConvertError, ValueError)) else f"{type(e).__name__}: {e}"
                self.update(job_id, status="error", error=msg, finished=time.time())
                activity.log(job["user"], self.tool, f"Échec : {job['title']} ({msg[:80]})", f"#/{self.tool}", "err")
            self.queue.task_done()

    def _janitor(self):
        while True:
            time.sleep(1800)
            now = time.time()
            with self.lock:
                old = [j for j in self.jobs.values() if j.get("finished") and now - j["finished"] > JOB_TTL]
                for j in old:
                    del self.jobs[j["id"]]
            for j in old:
                shutil.rmtree(j["work"], ignore_errors=True)

    def start(self):
        for _ in range(self.workers):
            threading.Thread(target=self._worker, daemon=True).start()
        threading.Thread(target=self._janitor, daemon=True).start()
