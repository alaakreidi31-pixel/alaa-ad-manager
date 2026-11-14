# البنية الحالية للنظام

> هذا الملف يصف ما هو **موجود فعلاً** في الكود حتى نهاية الخطوة 1.5. ما لم يُبنَ بعد مذكور صراحةً في القسم الأخير.

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

## قاعدة البيانات

- مستخدمان: `alaa_migrator` يملك البنية، و`alaa_app` للبيانات فقط. انظر [ADR 0009](decisions/0009-database-roles-and-migrations.md).
- الـ migrations في `apps/api/prisma/migrations/`، وملفات التراجع في `apps/api/prisma/rollbacks/`.

### جدول `sessions` (migration `20261114110456_create_sessions`)

- جلسة لكل تسجيل دخول. يُخزَّن **SHA-256 للـ refresh token فقط**، وليس الرمز نفسه.
- `revoked_at` يُضبط عند الخروج، وعند التجديد، وعند اكتشاف إعادة استخدام رمز قديم. الجلسات لا تُحذف.
- مرتبط بـ `users` بـ `ON DELETE RESTRICT`.

## تسجيل الدخول (`/api/auth`)

| النقطة                      | الوظيفة                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `POST /api/auth/login`      | بريد وكلمة مرور ← Access Token في الرد، وRefresh Token في cookie        |
| `POST /api/auth/refresh`    | يستبدل الـ refresh token بآخر جديد (rotation)، ويعطي Access Token جديداً |
| `POST /api/auth/logout`     | يلغي الجلسة ويحذف الـ cookie                                            |
| `GET /api/auth/me`          | بيانات المستخدم الحالي، ويتطلب `Authorization: Bearer`                  |
| `POST /api/auth/2fa/verify` | الخطوة الثانية: التذكرة المؤقتة مع رمز التطبيق أو رمز احتياطي ← الجلسة  |

التفاصيل والأسباب في [ADR 0011](decisions/0011-sessions-and-tokens.md).

**الحماية من التخمين ([ADR 0012](decisions/0012-brute-force-protection.md)):** 5 كلمات مرور خاطئة متتالية تقفل الحساب 15 دقيقة (العمودان `failed_login_attempts` و`locked_until` في `users`)، و`login` و`refresh` محدودان بـ 10 طلبات في الدقيقة لكل IP. الرد في الحالتين 429.

**التحقق بخطوتين ([ADR 0013](decisions/0013-two-factor-authentication.md)):** إذا كان الحساب يستخدم 2FA، يعيد `login` تذكرة مؤقتة (5 دقائق) بدل الجلسة، وتُفتح الجلسة بعد `2fa/verify`. حساب `SUPER_ADMIN` دون 2FA يُرفض (403). خوارزمية TOTP في `apps/api/src/auth/totp.ts`، والتشفير AES-256-GCM في `secret-box.ts`، والتفعيل بالأمر `pnpm admin:setup-2fa`.

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

## الاختبارات الموجودة (140 اختباراً)

| الملف                                                   | العدد | ماذا يحمي                                                                     |
| ------------------------------------------------------- | ----- | ----------------------------------------------------------------------------- |
| `apps/api/src/config/env.schema.spec.ts`                | 10    | حارس الإعدادات يقبل الصحيح ويرفض الناقص أو الخاطئ                             |
| `apps/api/src/health/health.controller.spec.ts`         | 2     | `/api/health` يعيد `up`، أو `down` مع 503                                     |
| `apps/api/src/users/email.spec.ts`                      | 4     | توحيد البريد                                                                  |
| `apps/api/src/testing/test-database.spec.ts`            | 5     | حارس قاعدة الاختبار، ولا يُظهر كلمة المرور                                     |
| `apps/api/src/users/users.db-spec.ts`                   | 12    | جدول المستخدمين على PostgreSQL الحقيقي، وأن `alaa_app` لا يغيّر البنية         |
| `apps/api/src/auth/password.spec.ts`                    | 9     | تشفير argon2id، والتحقق، وسياسة كلمة المرور                                   |
| `apps/api/src/users/create-super-admin.db-spec.ts`      | 8     | إنشاء SUPER_ADMIN: واحد فقط، وتشفير كلمة المرور، ورفض المدخلات الخاطئة        |
| `apps/api/src/auth/tokens.spec.ts`                      | 9     | توليد الرموز وبصمتها، وقراءة الـ cookie والـ Bearer                           |
| `apps/api/src/auth/auth.service.db-spec.ts`             | 40    | الدخول، والتجديد، واكتشاف الرمز المسروق، والخروج، والإيقاف، وقفل الحساب، و2FA |
| `apps/api/src/auth/totp.spec.ts`                        | 15    | خوارزمية TOTP على متجهات RFC 6238 الرسمية، وBase32، ورابط QR                  |
| `apps/api/src/auth/secret-box.spec.ts`                  | 6     | تشفير AES-256-GCM: رفض القيمة المعدّلة والمفتاح الخاطئ                         |
| `apps/api/src/auth/recovery-codes.spec.ts`              | 4     | الرموز الاحتياطية: الصيغة، والتخزين كـ hash فقط                               |
| `apps/api/src/auth/rate-limiter.spec.ts`                | 5     | حد الطلبات لكل IP                                                             |
| `apps/api/src/migrations/create-users.rollback-spec.ts` | 2     | لكل migration ملف تراجع، والتراجع عن الكل ثم إعادة التطبيق                    |
| `apps/web/src/lib/health.test.ts`                       | 6     | الواجهة تتعامل مع كل حالات رد الخادم                                          |
| `apps/web/src/i18n/locales.test.ts`                     | 3     | ملفا الترجمة متطابقان في المفاتيح والمتغيرات، ولا نص فارغ                     |

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

- سجل التدقيق (1.6)، وصفحة الدخول في الواجهة (1.7). لا يوجد أي endpoint لتسجيل حساب جديد (ADR 0010).
- محتوى `packages/shared`: نوع `HealthResponse` معرّف حالياً في الخادم والواجهة كلٍّ على حدة، والخطة نقله إلى الحزمة المشتركة لاحقاً.
- Docker وأي إعداد للنشر.
- التكاملات مع Meta وGoogle وWhatsApp (مؤجلة إلى ما بعد النسخة الأساسية بقرار صاحبة المشروع).
- دور Team Member (مؤجل بقرار صاحبة المشروع).
