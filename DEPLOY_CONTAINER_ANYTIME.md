# دليل نشر المشروع كحاويات (في أي وقت)

هذا الدليل مخصص للنشر السريع والمتكرر لنفس المشروع على أي سيرفر Linux يدعم Docker.

## 1) المتطلبات على السيرفر

- Docker Engine
- Docker Compose Plugin (الأمر: docker compose)
- Git

للتأكد:

```bash
docker --version
docker compose version
git --version
```

## 2) فتح المنافذ (Firewall / Security Group)

المنافذ المطلوبة حسب docker-compose الحالي:

- 80/tcp
- 443/tcp
- 8080/tcp (واجهة التطبيق)
- 3000/tcp (signaling)
- 3478/tcp
- 3478/udp
- 5349/tcp
- 49160-49200/udp

## 3) أول نشر (مرة واحدة لكل سيرفر)

```bash
git clone <REPO_URL> web_caht_app
cd web_caht_app
cp .env.docker.example .env.docker
```

ثم عدل ملف .env.docker بالقيم الفعلية:

- PUBLIC_IP
- SIGNALING_DOMAIN
- FRONTEND_DOMAIN
- جميع قيم Firebase (VITE_FIREBASE_*)
- VITE_VAPID_PUBLIC_KEY
- TURN_USERNAME / TURN_PASSWORD

مهم:

- يجب وجود شهادات SSL داخل /etc/letsencrypt على السيرفر
- نفس المسار يتم تركيبه داخل حاويات nginx_signaling و coturn

## 4) تشغيل الحاويات

```bash
docker compose --env-file .env.docker up -d --build
```

## 5) التحقق بعد التشغيل

```bash
docker compose ps
docker compose --env-file .env.docker logs -f signaling
docker compose --env-file .env.docker logs -f coturn
```

فحوصات سريعة:

- http://<SERVER_PUBLIC_IP>:3000/health
- https://<SIGNALING_DOMAIN>/health
- http://<SERVER_PUBLIC_IP>:8080

## 6) إعادة النشر في أي وقت (بعد تحديث الكود)

نفذ من داخل مجلد المشروع:

```bash
git pull
docker compose --env-file .env.docker up -d --build
```

هذه العملية:

- تسحب آخر كود
- تعيد بناء الصور
- تعيد تشغيل الخدمات بدون حذف دائم للبيانات المعرفة كـ volumes

## 7) أوامر إدارة سريعة

```bash
docker compose --env-file .env.docker restart
docker compose --env-file .env.docker down
docker compose --env-file .env.docker logs -f
```

## 8) نسخة احتياطية من ملف البيئة

قبل أي تغيير كبير:

```bash
cp .env.docker .env.docker.backup
```

## 9) مشاكل شائعة

1. فشل nginx_signaling بسبب الشهادة:
- تأكد أن SIGNALING_DOMAIN صحيح
- تأكد أن ملفات الشهادة موجودة فعلا داخل /etc/letsencrypt/live/<domain>/

2. مكالمات WebRTC لا تعمل:
- تحقق من فتح منافذ TURN كاملة
- راجع سجلات coturn
- تأكد أن VITE_TURN_* و TURN_* متطابقين

3. frontend يعمل لكن socket يفشل:
- تأكد أن VITE_SIGNALING_SERVER يشير إلى wss://<SIGNALING_DOMAIN>
- تأكد أن FRONTEND_ORIGIN مضبوط بشكل صحيح

## 10) أمر موحد جاهز للاستخدام اليومي

```bash
git pull && docker compose --env-file .env.docker up -d --build && docker compose ps
```
