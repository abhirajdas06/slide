# Deployment guide — Ubuntu 24.04, Gunicorn + WhiteNoise + Nginx

Target: `multihost@hostingserver`, project in `/home/multihost/slide`, alongside your other apps.
Replace `slide.example.com` with your real (sub)domain everywhere.

**How the pieces fit**

| Piece | Job |
|---|---|
| Gunicorn (systemd service, unix socket) | Runs Django. A socket (not a port) means no clash with your other apps. |
| WhiteNoise | Serves the app's own CSS/JS (`/static/`) straight from Django, compressed + cached forever. |
| Nginx | Public entry point + HTTPS. Also serves the **uploaded** files in `/media/`. |

> **Why Nginx for `/media/`?** WhiteNoise only serves files that exist at deploy time (`collectstatic`).
> Uploads arrive while the site is running, and videos need range requests, so Nginx serves them.
> This is also what keeps 1000 images/videos fast.

---

## 1. Get the code onto GitHub (do this on your PC first)

The local folder is not a git repo yet. In `D:\Project\slide`:

```bash
git init
git add .
git commit -m "Initial gallery app"
git branch -M main
git remote add origin https://github.com/abhirajdas06/slide.git
git push -u origin main
```
(`venv/`, `media/`, `db.sqlite3` are already in `.gitignore`.)

## 2. Server prerequisites

```bash
ssh multihost@hostingserver
sudo apt update
sudo apt install -y python3-venv python3-dev git nginx ffmpeg
python3 --version        # Ubuntu 24.04 ships 3.12 — fine for Django 6.1
```
`ffmpeg` is optional but gives videos a poster thumbnail in the grid.
If `nginx` is already installed for your other sites, apt just skips it.

## 3. Clone and set up

```bash
cd /home/multihost
git clone https://github.com/abhirajdas06/slide.git
cd slide
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 4. Environment file

Generate a secret key and write the settings the app reads:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(60))"
nano /home/multihost/slide/.env
```
```ini
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=paste-the-generated-key-here
DJANGO_ALLOWED_HOSTS=slide.example.com
DJANGO_CSRF_TRUSTED_ORIGINS=https://slide.example.com
DJANGO_MEDIA_ROOT=/home/multihost/slide_media
```
```bash
chmod 600 /home/multihost/slide/.env
mkdir -p /home/multihost/slide_media
```
Keeping media **outside** the code folder means `git pull` can never touch uploads, and backups are simple.

## 5. Database, static files, test

```bash
set -a; source .env; set +a
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py check
```
(`check --deploy` will print an email-backend error and HSTS notes — the app sends no email, ignore the error.)

## 6. Gunicorn as a systemd service

```bash
sudo nano /etc/systemd/system/slide.service
```
```ini
[Unit]
Description=Slide gallery (gunicorn)
After=network.target

[Service]
User=multihost
Group=www-data
WorkingDirectory=/home/multihost/slide
EnvironmentFile=/home/multihost/slide/.env
ExecStart=/home/multihost/slide/venv/bin/gunicorn config.wsgi:application \
    --workers 3 --timeout 300 --bind unix:/run/slide/slide.sock
RuntimeDirectory=slide
RuntimeDirectoryMode=0755
Restart=always

[Install]
WantedBy=multi-user.target
```
`--timeout 300` lets large video uploads finish.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now slide
sudo systemctl status slide        # should say active (running)
```

## 7. Nginx

Nginx (user `www-data`) must be able to walk into your home directory and read the media folder:

```bash
sudo chmod o+x /home/multihost            # traverse only; does not expose file listings
sudo chgrp -R www-data /home/multihost/slide_media
sudo chmod -R g+rX /home/multihost/slide_media
sudo chmod g+s /home/multihost/slide_media   # new uploads inherit the group
```
New files Django writes are `0644`, so Nginx can read them. If you'd rather not touch your home dir permissions, put media in `/var/www/slide_media` instead (change `DJANGO_MEDIA_ROOT` and the `alias`, owner `multihost`).

```bash
sudo nano /etc/nginx/sites-available/slide
```
```nginx
server {
    listen 80;
    server_name slide.example.com;

    client_max_body_size 2G;          # largest single video you expect

    location /media/ {
        alias /home/multihost/slide_media/;
        expires 30d;
        add_header Cache-Control "public";
        access_log off;
    }

    location / {
        proxy_pass http://unix:/run/slide/slide.sock;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
        proxy_request_buffering off;  # stream big uploads to Django
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/slide /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```
Static files (`/static/...`) go through Gunicorn → WhiteNoise, which is what you asked for; no extra Nginx rule needed.

## 8. DNS + HTTPS

1. Add an **A record** `slide.example.com → <server public IP>`.
2. You already use Let's Encrypt for other sites, so certbot is probably installed:

```bash
sudo apt install -y certbot python3-certbot-nginx   # if missing
sudo certbot --nginx -d slide.example.com
```
Certbot edits the Nginx file to add HTTPS and the redirect. Visit `https://slide.example.com`.

## 9. Protect it (important)

**The app has no login: anyone who finds the URL can upload and delete.** Quick fix with Nginx basic auth:

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.slide_htpasswd yourname
```
Inside the `location /` block add:
```nginx
auth_basic "Gallery";
auth_basic_user_file /etc/nginx/.slide_htpasswd;
```
Then `sudo nginx -t && sudo systemctl reload nginx`. (Don't put it on `/media/` unless you want the browser to prompt for those requests too — it already has the credentials once logged in, so it's safe either way.)
If you want real per-user accounts later, that's a code change (Django login) — ask.

## 10. Updating later

```bash
cd /home/multihost/slide
git pull
source venv/bin/activate
pip install -r requirements.txt
set -a; source .env; set +a
python manage.py migrate
python manage.py collectstatic --noinput
sudo systemctl restart slide
```

## 11. Troubleshooting

| Symptom | Check |
|---|---|
| 502 Bad Gateway | `sudo systemctl status slide`, `journalctl -u slide -n 50` |
| 400 Bad Request | Domain missing from `DJANGO_ALLOWED_HOSTS` |
| 403 on upload / "CSRF failed" | `DJANGO_CSRF_TRUSTED_ORIGINS` must include `https://…` |
| 413 on upload | Raise `client_max_body_size` |
| Thumbnails/media 404 or 403 | Nginx `alias` path, and `namei -l /home/multihost/slide_media/` shows `x` for `www-data` on every folder |
| Unstyled page | Re-run `collectstatic`, restart `slide` |
| Video has placeholder tile | `ffmpeg` not installed (videos still play) |

## 12. Backup

Everything that matters is two things: `/home/multihost/slide/db.sqlite3` and `/home/multihost/slide_media/`.

```bash
tar czf slide_backup_$(date +%F).tar.gz slide/db.sqlite3 slide_media
```
