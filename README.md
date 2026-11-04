# reviewHamza

مهارة لـ Claude Code تضيف **صفحة مراجعة (Review Desk)** إلى مشروع فيديو Remotion. تفتح الصفحة الفيديو مع خط زمني تضغط عليه لاختيار أي عنصر، ثم ترسل ملاحظاتك إلى Claude ليطبقها.

## 1. التثبيت (مرة واحدة فقط)

اكتب هذا الأمر في الطرفية:

macOS / Linux / Git Bash:

```bash
git clone https://github.com/hamza-tricking/reviewHamza ~/.claude/skills/reviewHamza
```

Windows PowerShell:

```powershell
git clone https://github.com/hamza-tricking/reviewHamza $env:USERPROFILE\.claude\skills\reviewHamza
```

أو اكتب لـ Claude: **ثبّت مهارة reviewHamza من https://github.com/hamza-tricking/reviewHamza**

## 2. تشغيل صفحة المراجعة

افتح Claude Code داخل مشروع Remotion، ثم اكتب:

```
/reviewHamza
```

سيركّب Claude صفحة المراجعة في المشروع ويشغّلها ويعطيك الرابط لفتحها.

## 3. المراجعة داخل الصفحة

- **اضغط أي عنصر** في الخط الزمني، فيُضاف مرجعه الدقيق إلى مربع النص.
- **اضغط Ctrl أو Shift** لاختيار عدة عناصر معاً.
- **اضغط المسطرة الزمنية** لاختيار لحظة، أو **اسحب عليها** لاختيار مدى زمني.
- **وضع 💬 Comment:** اضغط عنصراً واكتب ملاحظة تظهر فوق الخط الزمني.
- **Send to Claude:** يحفظ ملاحظاتك ويرسلها إلى Claude.

## 4. تطبيق الملاحظات

ارجع إلى Claude واكتب:

```
apply review
```

سيطبّق Claude الملاحظات على الكود. بعدها اضغط «↻ Reload timeline» في الصفحة لترى التغيير. لن يصدّر Claude الفيديو إلا إذا طلبت ذلك.

## المتطلبات

- Node.js.
- مشروع Remotion يحتوي على `src/Main.tsx` و`src/Segments.tsx`.
- الحزم `esbuild` و`@remotion/player` داخل `node_modules` (إن لم تكن موجودة سيثبتها Claude).

## تحديث المهارة

```bash
cd ~/.claude/skills/reviewHamza && git pull
```

## ما في المستودع

- `SKILL.md`: تعليمات المهارة لـ Claude.
- `template/`: قالب صفحة المراجعة الذي يُنسخ إلى مشروعك (`review/` و`fonts/` و`README.md`).
