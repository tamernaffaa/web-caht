# Docker Deployment on AWS EC2

This setup runs the full stack in containers:
- Frontend (React build served by Nginx on 8080)
- Signaling server (Node.js + Express + Socket.io on 3000 internal/public for debug)
- Nginx edge proxy (80/443 for HTTPS + WSS to signaling)
- TURN/STUN (coturn with TLS on 5349)

## 1) EC2 prerequisites

Open these inbound ports in the EC2 Security Group:
- 22/tcp (SSH)
- 80/tcp (Nginx edge)
- 443/tcp (Nginx edge TLS)
- 3000/tcp (optional direct signaling debug access)
- 3478/tcp and 3478/udp (TURN/STUN)
- 5349/tcp (TLS TURN)
- 49160-49200/udp (TURN relay range)

Install Docker + Compose plugin:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Logout/login once after adding your user to docker group.

## 2) Prepare project

```bash
git clone <YOUR_REPO_URL> web_chat_app
cd web_chat_app
cp .env.docker.example .env.docker
```

Edit `.env.docker` and replace placeholders:
- `PUBLIC_IP`
- `SIGNALING_DOMAIN`
- `FRONTEND_DOMAIN`
- Firebase values
- VAPID key
- TURN username/password

## 3) Build and run

```bash
docker compose --env-file .env.docker up -d --build
```

Check services:

```bash
docker compose ps
docker compose logs -f signaling
docker compose logs -f coturn
```

Health check:
- `http://<EC2_PUBLIC_IP>:3000/health` (direct signaling)
- `https://<SIGNALING_DOMAIN>/health` (through Nginx edge)

## 4) Update deployment

```bash
git pull
docker compose --env-file .env.docker up -d --build
```

## 5) Useful commands

```bash
docker compose --env-file .env.docker down
docker compose --env-file .env.docker restart
docker compose --env-file .env.docker logs -f
```

## Notes
- Keep `VITE_SIGNALING_SERVER` as `wss://<SIGNALING_DOMAIN>` to avoid mixed-content issues.
- For restrictive networks, keep `VITE_FORCE_TURN=true`.
- Certificates are mounted from host path `/etc/letsencrypt` into both `nginx_signaling` and `coturn` containers.
