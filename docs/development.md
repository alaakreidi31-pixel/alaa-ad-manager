# دليل التطوير

## 1. تجهيز جهاز جديد

هذه هي الخطوات التي نُفّذت فعلاً على جهاز التطوير الحالي (Windows).

### البرامج المطلوبة

| البرنامج   | النسخة المطلوبة | ملاحظة                                                                                                    |
| ---------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| Git        | أي نسخة حديثة   | الفرع الافتراضي `main`                                                                                    |
| Node.js    | 22 أو أحدث      | محدد في `.nvmrc` و`package.json`. الجهاز الحالي: 22.14.0                                                  |
| pnpm       | 10 أو أحدث      | التثبيت: `npm install -g pnpm@10`                                                                         |
| PostgreSQL | 17              | مثبّت مباشرة على Windows، على المنفذ 5432. انظر [ADR 0003](decisions/0003-postgresql-native-on-windows.md) |
| VS Code    | أي نسخة حديثة   | الإضافات المقترحة في `.vscode/extensions.json`                                                            |

ملف `.npmrc` فيه `engine-strict=true`، فيرفض pnpm التثبيت إذا كانت نسخة Node أو pnpm أقدم من المطلوب.

### إنشاء مستخدم وقاعدتي بيانات المشروع

أداة `psql` ليست في مسار النظام (PATH) على الجهاز الحالي، لذلك تُستدعى بمسارها الكامل في PowerShell:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost
```

ثم داخل `psql`:

المشروع يستخدم مستخدمَين منفصلين. انظر [ADR 0009](decisions/0009-database-roles-and-migrations.md).

- `alaa_migrator`: يملك القاعدتين، وتستخدمه أوامر Prisma فقط لتغيير البنية.
- `alaa_app`: يستخدمه الخادم، ويقرأ البيانات ويكتبها فقط.

```sql
CREATE ROLE alaa_migrator WITH LOGIN CREATEDB;
\password alaa_migrator
CREATE ROLE alaa_app WITH LOGIN;
\password alaa_app
CREATE DATABASE alaa_ad_manager_dev OWNER alaa_migrator;
CREATE DATABASE alaa_ad_manager_test OWNER alaa_migrator;
```

ثم لكل قاعدة من القاعدتين (`\c alaa_ad_manager_dev` ثم `\c alaa_ad_manager_test`):

```sql
GRANT USAGE ON SCHEMA public TO alaa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE alaa_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO alaa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE alaa_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO alaa_app;
```

ثم `\q`.

- الأمر `\password` يطلب كلمة المرور دون أن تظهر على الشاشة أو تُحفظ في سجل الأوامر.
- يُفضّل أن تتكون كلمة المرور من أحرف إنجليزية وأرقام فقط، لأن الرموز مثل `@ : / % #` تحتاج ترميزاً خاصاً داخل رابط الاتصال.

للتأكد من أن المستخدم الجديد يستطيع الدخول:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U alaa_app -h localhost -d alaa_ad_manager_dev -c "SELECT current_user, current_database();"
```

### ملف الإعدادات `.env`

```powershell
Copy-Item "apps\api\.env.example" "apps\api\.env"
```

ثم في `apps\api\.env` تُستبدل كل `CHANGE_ME` بكلمة مرور المستخدم المذكور في نفس السطر (`alaa_app` أو `alaa_migrator`).

- ملف `.env` محمي بـ `.gitignore` ولا يُحفظ في Git أبداً.
- لا يُصوَّر ولا يُرسل ولا يُنسخ إلى التوثيق.

### التثبيت والتشغيل

```powershell
pnpm install
pnpm --filter @alaa/api exec prisma migrate deploy
pnpm dev
```

الأمر الثاني يطبّق الـ migrations على قاعدة التطوير بمستخدم `alaa_migrator`.

ثم في المتصفح: `http://127.0.0.1:5173`

### إنشاء حساب SUPER_ADMIN

مرة واحدة على كل قاعدة. أوقفي `pnpm dev` أولاً، لأن الأمر يبني نسخة الخادم في `dist`:

```powershell
pnpm admin:create-super-admin
```

يسأل عن البريد والاسم وكلمة المرور (12 حرفاً على الأقل، ولا تظهر أثناء الكتابة). لا يوجد تسجيل عام. انظر [ADR 0010](decisions/0010-no-public-registration.md).

## 2. العمل اليومي

1. `pnpm dev` لتشغيل الخادم والواجهة. الإيقاف: `Ctrl + C`.
2. قبل كل commit: `pnpm check`. يجب أن تمر المراحل الأربع كلها.
3. رسائل الـ commit تتبع نظام Conventional Commits:
   - `feat:` ميزة جديدة
   - `fix:` إصلاح خطأ
   - `chore:` عمل تنظيمي أو أدوات
   - `style:` تنسيق فقط، بلا تغيير في المنطق
   - `docs:` توثيق

### نصائح عملية على Windows

- **طرفية واحدة لـ `pnpm dev`، وطرفية ثانية للأوامر** مثل `git` و`pnpm check`.
- **أسماء الملفات تُكتب باليد.** نسخها من صفحة نصها عربي قد يضيف حروفاً خفية فيرفضها VS Code.
- **فكّ الملفات المضغوطة إلى جذر المشروع**، وليس إلى مجلد Downloads:
  ```powershell
  Expand-Archive "C:\Users\<USER>\Downloads\<FILE>.zip" -DestinationPath "C:\dev\alaa-ad-manager" -Force
  ```

### قواعد قاعدة البيانات

- **migration جديدة:** `prisma migrate dev --create-only` أولاً، ثم مراجعة ملف SQL، ثم التطبيق.
- **ممنوع على قاعدة التطوير** دون موافقة صاحبة المشروع: `prisma migrate reset`، وأي ملف في `prisma/rollbacks/`.
- `pnpm test:db` و`pnpm test:rollback` يعملان على قاعدة ينتهي اسمها بـ `_test` فقط، ويرفضان غيرها.

## 3. مشاكل واجهناها وحلولها

كل المشاكل التالية حدثت فعلاً أثناء المرحلة 0.

### صفحة بيضاء فارغة، وفي Console الخطأ `ERR_BLOCKED_BY_CLIENT`

- **السبب:** إضافة مانع إعلانات في Chrome تحجب ملفات المشروع، لأن مسارها يحتوي `alaa-ad-manager`، وكلمة `ad` تشبه روابط الإعلانات.
- **الحل:** استثناء `127.0.0.1` من مانع الإعلانات، أو استخدام نافذة التصفح المتخفي `Ctrl + Shift + N`.
- **للتأكد:** `F12` ثم Console. إذا كانت الأخطاء كلها `ERR_BLOCKED_BY_CLIENT` فالسبب هو الإضافة.
- انظر أيضاً [ADR 0006](decisions/0006-no-ad-keywords-in-urls.md).

### `EADDRINUSE: address already in use 127.0.0.1:3000`

- **السبب:** نسخة أخرى من الخادم تعمل بالفعل في طرفية أخرى.
- **الحل:** إغلاق كل الطرفيات بأيقونة سلة المهملات في VS Code، ثم تشغيل `pnpm dev` مرة واحدة.

### `http proxy error` و`ECONNREFUSED 127.0.0.1:3000` مباشرة بعد `pnpm dev`

- **السبب:** الواجهة تجهز خلال ثوانٍ، أما الخادم فيحتاج قرابة 30 ثانية على الجهاز الحالي (توليد Prisma ثم ترجمة TypeScript). أي طلب قبل جاهزية الخادم يفشل.
- **الحل:** الانتظار حتى يظهر `API running`، ثم الضغط على "إعادة الفحص" في الصفحة.

### `/api/health` يعيد `"database":"down"`

- **السبب المعتاد:** خطأ في `DATABASE_URL` داخل `apps/api/.env`، غالباً في كلمة المرور.
- **التشخيص:** الطرفية تعرض سطراً يبدأ بـ `Database check failed:` فيه سبب الخطأ، ولا يحتوي كلمة المرور.
- **تحقق من:** أن الشكل `postgresql://alaa_app:PASSWORD@localhost:5432/alaa_ad_manager_dev`، وأنه لا توجد مسافات، وأن `@localhost` تأتي مباشرة بعد كلمة المرور.

### `password authentication failed` عند الدخول بـ `psql`

- **السبب:** كلمة المرور غير مطابقة للمستخدم المحدد بعد `-U`.
- **الحل:** نسخ كلمة المرور ولصقها بالزر الأيمن للماوس عند الطلب. الحروف لا تظهر أثناء الكتابة، وهذا طبيعي.

### `pnpm` لا يعمل بعد تثبيته بأحدث نسخة

- **ما حدث:** بعد `npm install -g pnpm` ظهر خطأ عند تشغيل `pnpm --version`.
- **الحل الذي نجح:** `npm uninstall -g pnpm` ثم `npm install -g pnpm@10`.

### `127.0.0.1` لا يفتح من الهاتف

- **هذا مقصود.** العنوان `127.0.0.1` يعني الجهاز نفسه، والخادم يستمع على اللابتوب وحده أثناء التطوير. انظر [ADR 0004](decisions/0004-local-security-defaults.md).

### `Command "dev" not found`

- حدث عند تشغيل `pnpm dev` قبل إضافته في الخطوة 0.7. الأمر موجود الآن في `package.json` في الجذر.
