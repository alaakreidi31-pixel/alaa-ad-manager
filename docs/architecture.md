# البنية الحالية للنظام

> هذا الملف يصف ما هو **موجود فعلاً** في الكود حتى نهاية الخطوة 2.3. ما لم يُبنَ بعد مذكور صراحةً في القسم الأخير.

## الصورة العامة

```
المتصفح
  │  http://127.0.0.1:5173
  ▼
الواجهة (apps/web)  ── Vite dev server ──┐
  │                                       │ أي طلب يبدأ بـ /api يُمرَّر (proxy)
  │                                       ▼
  │                         الخادم (apps/api)  ── NestJS على 127.0.0.1:3000
  │                                       │
  │                                       │ Prisma 7 + @prisma/adapter-pg
  │                                       ▼
  │                         PostgreSQL 17  ── localhost:5432
  │                         قاعدة: alaa_ad_manager_dev، المستخدم: alaa_app
```

- المتصفح يتحدث مع **عنوان واحد فقط** (5173). Vite يمرّر طلبات `/api` إلى الخادم، فلا نحتاج إعداد CORS أثناء التطوير. (`apps/web/vite.config.ts`)
- كل مسارات الخادم تبدأ بالبادئة `/api`. (`apps/api/src/main.ts`)
- الخادم والواجهة يستمعان على `127.0.0.1` فقط أثناء التطوير. انظر [ADR 0004](decisions/0004-local-security-defaults.md).

## ما الذي يعمل الآن

| الجزء                   | الوصف                                                                                              | الملف الرئيسي                              |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `GET /api/health`       | يعيد حالة الخادم وقاعدة البيانات. عند تعذّر الاتصال بالقاعدة يعيد `database: "down"` مع رمز **503** | `apps/api/src/health/health.controller.ts` |
| فحص الإعدادات           | يتحقق من `.env` عند التشغيل بمكتبة Zod، ويرفض التشغيل برسالة واضحة إذا نقص إعداد أو كان خاطئاً      | `apps/api/src/config/env.schema.ts`        |
| الاتصال بقاعدة البيانات | اتصال واحد مشترك (connection pool)، يتصل عند أول استعلام، بمهلة 5 ثوانٍ                             | `apps/api/src/prisma/prisma.service.ts`    |
| صفحة حالة النظام        | تعرض حالة الخادم وقاعدة البيانات بالأخضر أو الأحمر، مع زر إعادة الفحص                              | `apps/web/src/components/SystemStatus.tsx` |
| الهوية البصرية          | الألوان (أسود `ink` وذهبي `gold`) معرّفة في مكان واحد، وشعار نصي مؤقت                               | `apps/web/src/index.css`، `Logo.tsx`       |
| اللغتان                 | عربي وإنجليزي مع قلب الاتجاه (RTL)                                                                 | `apps/web/src/i18n/`                       |

## صفحات الواجهة ([ADR 0015](decisions/0015-web-session-and-routing.md))

| المسار                                                     | الصفحة                                                                                                                                                        | الملف                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `/login`                                                   | الدخول: البريد وكلمة المرور، ثم رمز 2FA أو رمز احتياطي                                                                                                        | `apps/web/src/pages/LoginPage.tsx`                |
| `/`                                                        | الرئيسية حسب الدور: للإدارة لوحة بأرقام حقيقية (`pages/admin/AdminDashboardPage.tsx`)، وللعميل نظرة عامة على شركته وحسابه (`pages/client/ClientHomePage.tsx`) | `apps/web/src/pages/HomePage.tsx`                 |
| `/admin/clients`                                           | قائمة العملاء: بحث، وفلتر الحالة، وصفحات (`SUPER_ADMIN` فقط)                                                                                                  | `apps/web/src/pages/admin/ClientsListPage.tsx`    |
| `/admin/clients/new` و`/admin/clients/:id/edit`            | إضافة عميل وتعديله                                                                                                                                            | `apps/web/src/pages/admin/ClientFormPage.tsx`     |
| `/admin/clients/:id`                                       | تفاصيل العميل، وحالته، وحسابات دخوله، وكلمة المرور المؤقتة (تظهر مرة واحدة)                                                                                   | `apps/web/src/pages/admin/ClientDetailPage.tsx`   |
| `/admin/campaigns`                                         | كل الحملات: بحث باسم الحملة أو العميل، وفلتر المنصة والحالة                                                                                                   | `apps/web/src/pages/admin/CampaignsListPage.tsx`  |
| `/admin/clients/:id/campaigns/new` و`.../:campaignId/edit` | إضافة حملة لعميل وتعديلها                                                                                                                                     | `apps/web/src/pages/admin/CampaignFormPage.tsx`   |
| `/admin/clients/:id/campaigns/:campaignId`                 | الحملة وحالتها، والأرقام اليومية مع المجاميع، وإدخال يوم أو تصحيحه                                                                                            | `apps/web/src/pages/admin/CampaignDetailPage.tsx` |

- الجلسة في `apps/web/src/auth/auth-context.tsx`: الـ Access Token في الذاكرة فقط، ويُجدَّد تلقائياً قبل انتهائه.
- التنقل بمكتبة `react-router` الإصدار 7.

## مسارات الإدارة (`/api/admin`)

كلها لـ `SUPER_ADMIN` فقط (`AccessTokenGuard` ثم `SuperAdminGuard`). حساب العميل يحصل على 403.

| النقطة                                                                                     | الوظيفة                                                          |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `GET /api/admin/dashboard`                                                                 | ملخص اللوحة: العملاء والحسابات حسب الحالة، وآخر 5 عملاء          |
| `GET /api/admin/clients`                                                                   | القائمة: `search` و`status` و`page` و`pageSize`                  |
| `POST /api/admin/clients`                                                                  | إضافة عميل                                                       |
| `GET /api/admin/clients/:id`                                                               | تفاصيل عميل                                                      |
| `PATCH /api/admin/clients/:id`                                                             | تعديل (مرفوض للعميل المؤرشف)                                     |
| `POST /api/admin/clients/:id/suspend`                                                      | إيقاف مؤقت                                                       |
| `POST /api/admin/clients/:id/archive`                                                      | أرشفة                                                            |
| `POST /api/admin/clients/:id/activate`                                                     | إعادة تفعيل                                                      |
| `GET /api/admin/campaigns`                                                                 | كل الحملات مع اسم العميل: `search` و`status` و`platform` و`page` |
| `GET /api/admin/clients/:id/campaigns`                                                     | حملات العميل: `status` و`platform` و`page` و`pageSize`           |
| `POST /api/admin/clients/:id/campaigns`                                                    | إضافة حملة Meta أو Google (مرفوض للعميل المؤرشف)                 |
| `GET /api/admin/clients/:id/campaigns/:campaignId`                                         | تفاصيل حملة                                                      |
| `PATCH /api/admin/clients/:id/campaigns/:campaignId`                                       | تعديل (مرفوض للحملة المؤرشفة)                                    |
| `POST /api/admin/clients/:id/campaigns/:campaignId/pause` و`/activate` و`/end` و`/archive` | تغيير حالة الحملة                                                |
| `GET /api/admin/clients/:id/users`                                                         | حسابات دخول العميل                                               |
| `POST /api/admin/clients/:id/users`                                                        | إضافة حساب: كلمة مرور مؤقتة تظهر في الرد مرة واحدة               |
| `POST /api/admin/clients/:id/users/:userId/reset-password`                                 | كلمة مرور مؤقتة جديدة، وتُغلق كل جلسات الحساب                     |
| `POST /api/admin/clients/:id/users/:userId/suspend`                                        | إيقاف حساب واحد                                                  |
| `POST /api/admin/clients/:id/users/:userId/activate`                                       | إعادة تفعيل حساب                                                 |

## بوابة العميل (`/api/client`)

لحسابات `CLIENT_USER` فقط (`AccessTokenGuard` ثم `ClientUserGuard`). **لا يقبل أي مسار رقم عميل من الطلب**: العميل يُؤخذ من الجلسة دائماً.

| النقطة                    | الوظيفة                                     |
| ------------------------- | ------------------------------------------- |
| `GET /api/client/profile` | بيانات شركة العميل، بدون الملاحظات الداخلية |

## قاعدة البيانات

- مستخدمان: `alaa_migrator` يملك البنية، و`alaa_app` للبيانات فقط. انظر [ADR 0009](decisions/0009-database-roles-and-migrations.md).
- الـ migrations في `apps/api/prisma/migrations/`، وملفات التراجع في `apps/api/prisma/rollbacks/`.

### جدول `sessions` (migration `20261114110456_create_sessions`)

- جلسة لكل تسجيل دخول. يُخزَّن **SHA-256 للـ refresh token فقط**، وليس الرمز نفسه.
- `revoked_at` يُضبط عند الخروج، وعند التجديد، وعند اكتشاف إعادة استخدام رمز قديم. الجلسات لا تُحذف.
- مرتبط بـ `users` بـ `ON DELETE RESTRICT`.

## تسجيل الدخول (`/api/auth`)

| النقطة                           | الوظيفة                                                                 |
| -------------------------------- | ----------------------------------------------------------------------- |
| `POST /api/auth/login`           | بريد وكلمة مرور ← Access Token في الرد، وRefresh Token في cookie        |
| `POST /api/auth/refresh`         | يستبدل الـ refresh token بآخر جديد (rotation)، ويعطي Access Token جديداً |
| `POST /api/auth/logout`          | يلغي الجلسة ويحذف الـ cookie                                            |
| `GET /api/auth/me`               | بيانات المستخدم الحالي، ويتطلب `Authorization: Bearer`                  |
| `POST /api/auth/2fa/verify`      | الخطوة الثانية: التذكرة المؤقتة مع رمز التطبيق أو رمز احتياطي ← الجلسة  |
| `POST /api/auth/password/change` | بعد كلمة مرور مؤقتة: كلمة المرور الجديدة ← الجلسة (أو خطوة 2FA)         |

التفاصيل والأسباب في [ADR 0011](decisions/0011-sessions-and-tokens.md).

**الحماية من التخمين ([ADR 0012](decisions/0012-brute-force-protection.md)):** 5 كلمات مرور خاطئة متتالية تقفل الحساب 15 دقيقة (العمودان `failed_login_attempts` و`locked_until` في `users`)، و`login` و`refresh` محدودان بـ 10 طلبات في الدقيقة لكل IP. الرد في الحالتين 429.

**التحقق بخطوتين ([ADR 0013](decisions/0013-two-factor-authentication.md)):** إذا كان الحساب يستخدم 2FA، يعيد `login` تذكرة مؤقتة (5 دقائق) بدل الجلسة، وتُفتح الجلسة بعد `2fa/verify`. حساب `SUPER_ADMIN` دون 2FA يُرفض (403). خوارزمية TOTP في `apps/api/src/auth/totp.ts`، والتشفير AES-256-GCM في `secret-box.ts`، والتفعيل بالأمر `pnpm admin:setup-2fa`.

### جدول `campaign_daily_metrics` (migration `20261115160000_create_campaign_daily_metrics`)

- صف واحد لكل حملة في كل يوم (فهرس فريد): حفظ اليوم مرة ثانية يصحّحه ولا يكرره.
- الإنفاق `spend_minor` بأصغر وحدة لعملة الحملة، والتحويلات عدد عشري (ليست مالاً). لا حذف، وقاعدة البيانات ترفض الأرقام السالبة.

### جدول `campaigns` (migration `20261115140000_create_campaigns`)

- حملات Meta وGoogle لكل عميل. لا حذف: الحملة تُؤرشف، و`alaa_app` لا يملك `DELETE`. انظر [ADR 0018](decisions/0018-campaigns.md).
- الميزانية اليومية `daily_budget_minor` عدد صحيح بأصغر وحدة للعملة ([ADR 0008](decisions/0008-money-as-integer-minor-units.md)).
- `external_id` (رقم الحملة في المنصة) لا يتكرر للعميل نفسه على المنصة نفسها.

### جدول `clients` (migration `20261115090000_create_clients`)

- عملاء الوكالة. لا حذف: `alaa_app` لا يملك `DELETE` على هذا الجدول، والعميل يُؤرشف. انظر [ADR 0016](decisions/0016-client-management.md).
- `internal_notes` سرية، للإدارة فقط.

### جدول `audit_logs` (migration `20261114210000_create_audit_logs`)

- سجل الأحداث الأمنية (الدخول، والفشل، والقفل، و2FA، والخروج، والأوامر الإدارية). انظر [ADR 0014](decisions/0014-audit-log.md).
- **للإضافة فقط:** `alaa_app` لا يملك `UPDATE` ولا `DELETE` على هذا الجدول، فقاعدة البيانات ترفض تعديل السجل أو حذفه.
- بلا Foreign Key إلى `users` عن قصد. لا يحتوي أي كلمة مرور أو token أو رمز.
- الكتابة عبر `apps/api/src/audit/audit.service.ts`.

### جدول `recovery_codes` (migration `20261114120000_add_two_factor`)

- 10 رموز احتياطية لكل مستخدم مفعّل 2FA. يُخزَّن **SHA-256 فقط**، و`used_at` يُضبط عند الاستخدام.
- الـ migration نفسها أضافت إلى `users`: `totp_secret_encrypted` (مشفّر)، و`totp_enabled_at`، و`totp_last_used_step` (يمنع قبول الرمز نفسه مرتين)، وشرط `users_totp_consistent_check`.

### جدول `users` (migration `20261114093306_create_users`)

- `id` من نوع `uuid` تولّده القاعدة.
- `email` فريد، ومحمي بشرط `users_email_normalized_check`: بلا مسافات في الطرفين، وبأحرف صغيرة، وغير فارغ. التطبيق يوحّده بـ `normalizeEmail()` قبل التخزين.
- `full_name` و`password_hash` إلزاميان. كلمة المرور لا تُخزَّن أبداً، بل ناتج تشفيرها فقط.
- `role`: `SUPER_ADMIN` أو `CLIENT_USER`. `status`: `ACTIVE` (افتراضي) أو `SUSPENDED`. المستخدمون لا يُحذفون، بل يُوقَفون.
- `created_at` و`updated_at` من نوع `timestamptz(3)`.

## بنية المجلدات

```
alaa-ad-manager/
├── apps/
│   ├── api/                      الخادم (NestJS)
│   │   ├── prisma/schema.prisma  وصف قاعدة البيانات (بلا جداول بعد)
│   │   ├── prisma.config.ts      إعدادات Prisma 7
│   │   ├── .env.example          نموذج الإعدادات (بلا أسرار)
│   │   └── src/
│   │       ├── config/           فحص الإعدادات
│   │       ├── health/           نقطة /api/health
│   │       ├── prisma/           خدمة الاتصال بالقاعدة
│   │       └── generated/        كود يولّده Prisma تلقائياً (لا يُحفظ في Git)
│   └── web/                      الواجهة (React + Vite)
│       └── src/
│           ├── components/       الشعار، وزر اللغة، وبطاقة الحالة
│           ├── i18n/             الترجمة: ar.json و en.json
│           └── lib/              الاتصال بالخادم
├── packages/
│   └── shared/                   مخصص للكود المشترك. حالياً فيه package.json فقط
├── docs/                         هذا التوثيق
├── eslint.config.mjs             قواعد فحص الجودة
├── .prettierrc.json              قواعد التنسيق
└── package.json                  أوامر المشروع
```

## الأوامر

تُشغَّل كلها من جذر المشروع `C:\dev\alaa-ad-manager`:

| الأمر                           | الوظيفة                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm dev`                      | يشغّل الخادم والواجهة معاً في طرفية واحدة                                                  |
| `pnpm dev:api`                  | الخادم فقط                                                                               |
| `pnpm dev:web`                  | الواجهة فقط                                                                              |
| `pnpm test`                     | كل الاختبارات (Vitest)                                                                   |
| `pnpm typecheck`                | فحص TypeScript للخادم والواجهة                                                           |
| `pnpm lint`                     | فحص الجودة (ESLint)                                                                      |
| `pnpm test:db`                  | اختبارات على PostgreSQL الحقيقي، قاعدة `_test` فقط                                       |
| `pnpm admin:create-super-admin` | إنشاء حساب SUPER_ADMIN (أمر إداري، انظر ADR 0010)                                        |
| `pnpm admin:setup-2fa`          | تفعيل التحقق بخطوتين لحساب (أمر إداري، انظر ADR 0013)                                    |
| `pnpm test:rollback`            | اختبار التراجع عن الـ migrations، قاعدة `_test` فقط                                      |
| `pnpm generate`                 | توليد كود Prisma في `apps/api/src/generated`                                             |
| `pnpm format`                   | تنسيق كل الملفات (Prettier)                                                              |
| `pnpm check`                    | كل الفحوصات بالترتيب: التنسيق، ثم توليد كود Prisma، ثم الجودة، ثم الأنواع، ثم الاختبارات |

## الفحص التلقائي (CI)

- الملف: `.github/workflows/ci.yml`.
- مع كل رفع إلى GitHub، يجهّز GitHub جهازاً نظيفاً (Ubuntu)، ويثبّت pnpm 10 وNode بالنسخة المحددة في `.nvmrc`، ثم `pnpm install --frozen-lockfile`، ثم `pnpm check`.
- صلاحياته قراءة فقط، ولا يحتاج أي أسرار.
- **درس من أول تشغيل:** فشل ESLint على GitHub لأن كود Prisma المولَّد غير موجود على جهاز نظيف (فهو في `.gitignore`). لذلك أصبح `pnpm check` يشغّل `pnpm generate` قبل ESLint.

## الاختبارات الموجودة (308 اختبارات)

| الملف                                                     | العدد | ماذا يحمي                                                                                   |
| --------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------- |
| `apps/api/src/config/env.schema.spec.ts`                  | 10    | حارس الإعدادات يقبل الصحيح ويرفض الناقص أو الخاطئ                                           |
| `apps/api/src/health/health.controller.spec.ts`           | 2     | `/api/health` يعيد `up`، أو `down` مع 503                                                   |
| `apps/api/src/users/email.spec.ts`                        | 4     | توحيد البريد                                                                                |
| `apps/api/src/testing/test-database.spec.ts`              | 5     | حارس قاعدة الاختبار، ولا يُظهر كلمة المرور                                                   |
| `apps/api/src/users/users.db-spec.ts`                     | 12    | جدول المستخدمين على PostgreSQL الحقيقي، وأن `alaa_app` لا يغيّر البنية                       |
| `apps/api/src/auth/password.spec.ts`                      | 9     | تشفير argon2id، والتحقق، وسياسة كلمة المرور                                                 |
| `apps/api/src/users/create-super-admin.db-spec.ts`        | 9     | إنشاء SUPER_ADMIN: واحد فقط، وتشفير كلمة المرور، ورفض المدخلات الخاطئة                      |
| `apps/api/src/audit/audit.db-spec.ts`                     | 5     | سجل التدقيق: `alaa_app` يضيف ويقرأ فقط، ولا يعدّل ولا يحذف                                   |
| `apps/api/src/auth/tokens.spec.ts`                        | 9     | توليد الرموز وبصمتها، وقراءة الـ cookie والـ Bearer                                         |
| `apps/api/src/auth/auth.service.db-spec.ts`               | 48    | الدخول، والتجديد، واكتشاف الرمز المسروق، والخروج، والإيقاف، وقفل الحساب، و2FA، وسجل التدقيق |
| `apps/api/src/auth/auth.http-errors.spec.ts`              | 12    | كل خطأ دخول يصل إلى الواجهة برمز HTTP ورمز `code` ثابت                                      |
| `apps/api/src/auth/totp.spec.ts`                          | 15    | خوارزمية TOTP على متجهات RFC 6238 الرسمية، وBase32، ورابط QR                                |
| `apps/api/src/auth/secret-box.spec.ts`                    | 6     | تشفير AES-256-GCM: رفض القيمة المعدّلة والمفتاح الخاطئ                                       |
| `apps/api/src/auth/recovery-codes.spec.ts`                | 4     | الرموز الاحتياطية: الصيغة، والتخزين كـ hash فقط                                             |
| `apps/api/src/auth/rate-limiter.spec.ts`                  | 5     | حد الطلبات لكل IP                                                                           |
| `apps/api/src/migrations/create-users.rollback-spec.ts`   | 2     | لكل migration ملف تراجع، والتراجع عن الكل ثم إعادة التطبيق                                  |
| `apps/web/src/lib/health.test.ts`                         | 6     | الواجهة تتعامل مع كل حالات رد الخادم                                                        |
| `apps/web/src/lib/auth-api.test.ts`                       | 10    | الدخول، والخطوة الثانية، وترجمة رموز الأخطاء، وطلب تجديد واحد فقط في كل لحظة                |
| `apps/web/src/lib/api-client.test.ts`                     | 5     | الطلبات المحمية: الـ token، والتجديد مرة واحدة عند 401، ورموز الأخطاء                       |
| `apps/web/src/lib/reference-data.test.ts`                 | 3     | قوائم الدول والعملات والمناطق الزمنية في نموذج العميل                                       |
| `apps/api/src/auth/super-admin.guard.spec.ts`             | 3     | مسارات الإدارة لـ `SUPER_ADMIN` فقط                                                         |
| `apps/api/src/clients/clients.schemas.spec.ts`            | 14    | التحقق من بيانات العميل وتوحيدها                                                            |
| `apps/api/src/clients/clients.service.db-spec.ts`         | 16    | إدارة العملاء، والأرشفة، وسجل التدقيق، ومنع الحذف من قاعدة البيانات                         |
| `apps/api/src/clients/clients.http.db-spec.ts`            | 7     | عبر HTTP حقيقي: 401 بلا token، و403 لحساب العميل على كل مسار إداري، و404 للمعرّفات الخاطئة   |
| `apps/api/src/auth/temporary-password.spec.ts`            | 3     | كلمات المرور المؤقتة: الصيغة والقوة والعشوائية                                              |
| `apps/api/src/auth/client-user.guard.spec.ts`             | 3     | بوابة العميل لحسابات `CLIENT_USER` فقط                                                      |
| `apps/api/src/clients/client-accounts.db-spec.ts`         | 17    | حسابات العملاء: كلمة المرور المؤقتة، والتغيير الإجباري، وإيقاف العميل وأرشفته، وIDOR        |
| `apps/api/src/clients/client-portal.http.db-spec.ts`      | 7     | عبر HTTP: كل عميل يرى بياناته فقط، بلا ملاحظات داخلية، وIDOR بين عميلين                     |
| `apps/api/src/dashboard/dashboard.http.db-spec.ts`        | 4     | لوحة الإدارة: 401 و403، وأعداد حقيقية من القاعدة، وبلا ملاحظات داخلية                       |
| `apps/api/src/money/money.spec.ts`                        | 9     | المبالغ بأصغر وحدة للعملة (سنت، ين، فلس) بلا أي float                                       |
| `apps/api/src/campaigns/campaigns.schemas.spec.ts`        | 11    | التحقق من بيانات الحملة: المنصة، والمبلغ، والتواريخ، ورفض الحقول غير المسموحة               |
| `apps/api/src/campaigns/campaigns.service.db-spec.ts`     | 10    | الحملات: العملة، ورقم المنصة الفريد، والحالات، وIDOR، وسجل التدقيق، ومنع الحذف              |
| `apps/api/src/campaigns/campaigns.http.db-spec.ts`        | 4     | عبر HTTP: 401 و403 على كل مسار، ورموز الأخطاء، وIDOR بين عميلين                             |
| `apps/api/src/campaigns/campaign-metrics.db-spec.ts`      | 9     | الأرقام اليومية: يوم واحد لكل حملة (التصحيح لا يكرر)، والمجاميع الدقيقة، وقفل العملة، وIDOR |
| `apps/api/src/campaigns/campaign-metrics.http.db-spec.ts` | 4     | عبر HTTP: 401 و403، والحفظ بـ PUT، ورموز الأخطاء، وIDOR                                     |
| `apps/web/src/lib/campaigns-api.test.ts`                  | 2     | فترة آخر N يوماً، ونسب العرض (نسبة النقر، والتكلفة) بلا قسمة على صفر                         |
| `apps/web/src/i18n/locales.test.ts`                       | 3     | ملفا الترجمة متطابقان في المفاتيح والمتغيرات، ولا نص فارغ                                   |

على GitHub تعمل اختبارات القاعدة على PostgreSQL 17 مؤقت (service container) يُحذف بعد كل تشغيل.

## النسخ المثبّتة فعلياً

مأخوذة من `node_modules` على جهاز التطوير بتاريخ 2026-11-13:

| الأداة        | النسخة   |
| ------------- | -------- |
| Node.js       | 22.14.0  |
| pnpm          | 10.34.9  |
| PostgreSQL    | 17.11    |
| NestJS        | 11.2.10  |
| Prisma        | 7.10.1   |
| Zod           | 4.6.7    |
| React         | 19.3.1   |
| Vite          | 7.3.8    |
| Tailwind CSS  | 4.3.5    |
| i18next       | 25.10.10 |
| react-i18next | 16.6.6   |
| TypeScript    | 5.9.3    |
| Vitest        | 4.1.12   |
| ESLint        | 9.39.5   |
| Prettier      | 3.10.1   |

## ما لم يُبنَ بعد

- لا يوجد أي endpoint لتسجيل حساب جديد (ADR 0010)، وهذا مقصود.
- محتوى `packages/shared`: نوع `HealthResponse` معرّف حالياً في الخادم والواجهة كلٍّ على حدة، والخطة نقله إلى الحزمة المشتركة لاحقاً.
- Docker وأي إعداد للنشر.
- التكاملات مع Meta وGoogle وWhatsApp (مؤجلة إلى ما بعد النسخة الأساسية بقرار صاحبة المشروع).
- دور Team Member (مؤجل بقرار صاحبة المشروع).
