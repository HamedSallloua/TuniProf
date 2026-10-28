# Glossary: UI strings (French and Arabic)

Source of truth: `messages/fr.json` and `messages/ar.json`. Arabic is Modern Standard Arabic, drafted by the agent and **approved by the owner on 2026-10-27** (texts written later are drafts until approved).
`{brand}` is replaced by the `BRAND_NAME` constant, never typed in a string.

| Key                | French                                                                      | Arabic (approved)                                                   |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| meta.title         | {brand} \| Cours particuliers en Tunisie                                    | {brand} \| دروس خصوصية في تونس                                      |
| meta.description   | La plateforme tunisienne de cours particuliers, du primaire à l'université. | المنصة التونسية للدروس الخصوصية، من المرحلة الابتدائية إلى الجامعة. |
| a11y.skipToContent | Aller au contenu                                                            | انتقل إلى المحتوى                                                   |
| language.label     | Langue                                                                      | اللغة                                                               |
| header.homeLabel   | {brand}, retour à l'accueil                                                 | {brand}، العودة إلى الصفحة الرئيسية                                 |
| footer.copyright   | © {year} {brand}. Tous droits réservés.                                     | © {year} {brand}. جميع الحقوق محفوظة.                               |
| footer.tagline     | Cours particuliers, du primaire à l'université.                             | دروس خصوصية، من المرحلة الابتدائية إلى الجامعة.                     |
| home.title         | Trouvez le bon professeur près de chez vous                                 | اعثر على الأستاذ المناسب بالقرب منك                                 |
| home.subtitle      | La plateforme tunisienne de cours particuliers, du primaire à l'université. | المنصة التونسية للدروس الخصوصية، من المرحلة الابتدائية إلى الجامعة. |
| home.statusTitle   | Site en construction                                                        | الموقع قيد الإنشاء                                                  |
| home.statusBody    | Les premières fonctionnalités arrivent bientôt.                             | ستتوفر الميزات الأولى قريبًا.                                       |
| notFound.title     | Page introuvable                                                            | الصفحة غير موجودة                                                   |
| notFound.body      | Cette page n'existe pas ou a été déplacée.                                  | هذه الصفحة غير موجودة أو تم نقلها.                                  |
| notFound.backHome  | Retour à l'accueil                                                          | العودة إلى الصفحة الرئيسية                                          |

## Account screens (M2)

All the texts of sign-up, login, reviewer login, password reset, WhatsApp verification and the teacher and admin placeholder pages are in `messages/fr.json` and `messages/ar.json` under `auth` (fields, errors, signup, login, reviewer, reset, verify, space) and `header.login`. The Arabic was approved by the owner on 2026-10-27. Terms used: "Se connecter / تسجيل الدخول", "Mot de passe oublié / نسيت كلمة المرور", "Vérification par WhatsApp / التحقق عبر واتساب", "Laisser un avis / كتابة تقييم", "Espace professeur / فضاء الأستاذ". Phone numbers are always written left to right.

## Teacher profile and admin review (M3)

All the texts are in `messages/fr.json` and `messages/ar.json` under `profile` (form fields and hints, option lists for diploma, experience, modes and cycles, errors, status banners, the 8 refusal reasons, statuses) and `admin` (queue, detail page, actions, messages). The Arabic was approved by the owner on 2026-10-27. Refusal reasons: Informations incomplètes / معلومات ناقصة, Nom invalide / اسم غير صالح, Photo inadaptée / صورة غير مناسبة, Présentation avec coordonnées / تقديم يحتوي على بيانات اتصال, Présentation trop vague / تقديم غامض جدًا, Diplôme à préciser / الشهادة تحتاج إلى توضيح, Tarifs irréalistes / أسعار غير واقعية, Autre motif / سبب آخر.

## Subscription and payments (M4)

All the texts are in `messages/fr.json` and `messages/ar.json` under `subscription` (status, plans, methods, request, requestStatus, upgrade, code, errors, instructions), `adminPayments` (list, detail, checklist, forms, messages sent to the teacher) and `auth.signup.founding`. The Arabic was approved by the owner on 2026-10-27. Terms used: "Abonnement / الاشتراك", "Visibilité de mon profil / ظهور ملفي", "Dashboard / لوحة التحكم", "Code d'activation / رمز التفعيل", "Nouvelle formule / صيغة جديدة", "Ajout du Dashboard / إضافة لوحة التحكم", "Versement poste / CCP", "Flouci", "D17 / e-Dinar". The Arabic payment helper lines are **not written yet**: the owner sends them word for word.

## Catalogue names (seeded by migrations 0003 to 0006): owner to review the Arabic

Governorates (24): Tunis تونس · Ariana أريانة · Ben Arous بن عروس · Manouba منوبة · Nabeul نابل · Zaghouan زغوان · Bizerte بنزرت · Béja باجة · Jendouba جندوبة · Le Kef الكاف · Siliana سليانة · Sousse سوسة · Monastir المنستير · Mahdia المهدية · Sfax صفاقس · Kairouan القيروان · Kasserine القصرين · Sidi Bouzid سيدي بوزيد · Gabès قابس · Médenine مدنين · Tataouine تطاوين · Gafsa قفصة · Tozeur توزر · Kébili قبلي

| Level (French)      | Arabic (approved)                |
| ------------------- | -------------------------------- |
| Primaire 1 to 6     | السنة الأولى ... السادسة ابتدائي |
| Préparatoire 7 to 9 | السنة السابعة ... التاسعة أساسي  |
| Secondaire 1 to 4   | السنة الأولى ... الرابعة ثانوي   |
| Université L1 to L3 | إجازة 1 ... إجازة 3              |

| Subject (French)     | Arabic (approved)  |
| -------------------- | ------------------ |
| Anglais              | الإنجليزية         |
| Arabe                | العربية            |
| Français             | الفرنسية           |
| Histoire-Géo         | التاريخ والجغرافيا |
| Informatique         | الإعلامية          |
| Mathématiques        | الرياضيات          |
| Philosophie          | الفلسفة            |
| Physique             | الفيزياء           |
| Sciences Naturelles  | علوم الحياة والأرض |
| Économie             | الاقتصاد           |
| Chimie               | الكيمياء           |
| Allemand             | الألمانية          |
| Italien              | الإيطالية          |
| Espagnol             | الإسبانية          |
| Technologie          | التكنولوجيا        |
| Gestion/Comptabilité | التصرف والمحاسبة   |
| Éveil scientifique   | الإيقاظ العلمي     |

| Plan (French) | Arabic (approved) |
| ------------- | ----------------- |
| Mensuel       | شهري              |
| Trimestriel   | ثلاثي             |
| Semestriel    | سداسي             |
| Annuel        | سنوي              |

Language names in the switcher are always written in their own language: Français, العربية.

The payment page helper lines (spec 4.3) are **not** in this glossary yet: they must be copied word for word from the owner's brief.

## Public site (M5), Arabic, approved by the owner on 2026-10-27

| French                                                    | Arabic (approved)                                   |
| --------------------------------------------------------- | --------------------------------------------------- |
| Rechercher / Trouver un professeur                        | البحث / البحث عن أستاذ                              |
| Gouvernorat / Délégation                                  | الولاية / المعتمدية                                 |
| Voir les coordonnées                                      | عرض بيانات الاتصال                                  |
| Signaler ce profil                                        | الإبلاغ عن هذا الملف                                |
| À partir de X DT / heure                                  | ابتداءً من X د.ت / الساعة                           |
| Matières et tarifs                                        | المواد والأسعار                                     |
| Modes de cours (à domicile, chez le professeur, en ligne) | أنواع الدروس (في المنزل، عند الأستاذ، عبر الإنترنت) |
| Devenir professeur                                        | كن أستاذًا                                          |
| Comment payer                                             | كيفية الدفع                                         |
| Offre de lancement                                        | عرض الانطلاق                                        |
| Mon espace / Déconnexion                                  | فضائي / تسجيل الخروج                                |

The Arabic currency symbol used with amounts is د.ت.

## Reviews (M6), Arabic drafts to approve

| French                                          | Arabic (draft)                      |
| ----------------------------------------------- | ----------------------------------- |
| Avis / Laisser un avis                          | تقييم / اترك تقييمًا                |
| Avis vérifié par WhatsApp                       | تقييم تم التحقق منه عبر واتساب      |
| Réponse du professeur                           | رد الأستاذ                          |
| Mes avis                                        | تقييماتي                            |
| Signaler cet avis                               | الإبلاغ عن هذا التقييم              |
| Publier / Refuser / Masquer / Garder / Rétablir | نشر / رفض / إخفاء / الإبقاء / إعادة |
| Modération des avis                             | مراجعة التقييمات                    |

## Notifications (M7), Arabic drafts to approve

All the message texts are in `messages/ar.json` under `notifications.kinds`. Terms used:

| French                           | Arabic (draft)            |
| -------------------------------- | ------------------------- |
| Notifications                    | الإشعارات                 |
| Marquer comme lu                 | تعليم كمقروء              |
| Messages WhatsApp à envoyer      | رسائل واتساب للإرسال      |
| Marquer comme envoyé             | تعليم كمرسل               |
| Copier le texte français / arabe | نسخ النص الفرنسي / العربي |
| Mon abonnement                   | اشتراكي                   |
| Code d'activation                | رمز التفعيل               |

## Dashboard: groups and calendar (M8), Arabic drafts to approve

All the texts are in `messages/ar.json` under `dashboard`, `groups` and `calendar`. Terms used:

| French                               | Arabic (draft)          |
| ------------------------------------ | ----------------------- |
| Groupes                              | المجموعات               |
| Calendrier                           | التقويم                 |
| Semaine / Mois / Année               | الأسبوع / الشهر / السنة |
| Prochaines séances                   | الحصص القادمة           |
| Ajouter une séance                   | إضافة حصة               |
| Modifier la date                     | تعديل التاريخ           |
| Modifier calendrier                  | تعديل التقويم           |
| Choisir le nombre de semaines        | اختيار عدد الأسابيع     |
| Nombre de semaines                   | عدد الأسابيع            |
| Supprimer (séance)                   | حذف                     |
| Groupe vide                          | مجموعة فارغة            |
| Passée                               | منتهية                  |
| Rechercher une date                  | البحث عن تاريخ          |
| Aperçu du calendrier                 | معاينة التقويم          |
| Choix des jours                      | طريقة اختيار الأيام     |
| Par jours de la semaine              | حسب أيام الأسبوع        |
| Choisir les jours dans un calendrier | باختيار الأيام من تقويم |
| Liste des séances                    | قائمة الحصص             |
| Déplacée / Ajoutée                   | منقولة / مضافة          |
