export type Lang = 'ar' | 'en' | 'fr' | 'ur' | 'tr' | 'fa' | 'id' | 'bn';

export const LANGUAGES: { code: Lang; nativeName: string; flag: string }[] = [
  { code: 'ar', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'en', nativeName: 'English', flag: '🇬🇧' },
  { code: 'fr', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'ur', nativeName: 'اردو', flag: '🇵🇰' },
  { code: 'tr', nativeName: 'Türkçe', flag: '🇹🇷' },
  { code: 'fa', nativeName: 'فارسی', flag: '🇮🇷' },
  { code: 'id', nativeName: 'Indonesia', flag: '🇮🇩' },
  { code: 'bn', nativeName: 'বাংলা', flag: '🇧🇩' },
];

export const COUNTRY_CODES = [
  { code: '+20', country: 'مصر', flag: '🇪🇬' },
  { code: '+966', country: 'السعودية', flag: '🇸🇦' },
  { code: '+971', country: 'الإمارات', flag: '🇦🇪' },
  { code: '+972', country: 'فلسطين', flag: '🇵🇸' },
  { code: '+962', country: 'الأردن', flag: '🇯🇴' },
  { code: '+961', country: 'لبنان', flag: '🇱🇧' },
  { code: '+963', country: 'سوريا', flag: '🇸🇾' },
  { code: '+964', country: 'العراق', flag: '🇮🇶' },
  { code: '+967', country: 'اليمن', flag: '🇾🇪' },
  { code: '+968', country: 'عُمان', flag: '🇴🇲' },
  { code: '+974', country: 'قطر', flag: '🇶🇦' },
  { code: '+965', country: 'الكويت', flag: '🇰🇼' },
  { code: '+973', country: 'البحرين', flag: '🇧🇭' },
  { code: '+212', country: 'المغرب', flag: '🇲🇦' },
  { code: '+213', country: 'الجزائر', flag: '🇩🇿' },
  { code: '+216', country: 'تونس', flag: '🇹🇳' },
  { code: '+218', country: 'ليبيا', flag: '🇱🇾' },
  { code: '+249', country: 'السودان', flag: '🇸🇩' },
  { code: '+252', country: 'الصومال', flag: '🇸🇴' },
  { code: '+90', country: 'تركيا', flag: '🇹🇷' },
  { code: '+92', country: 'باكستان', flag: '🇵🇰' },
  { code: '+880', country: 'بنغلاديش', flag: '🇧🇩' },
  { code: '+62', country: 'إندونيسيا', flag: '🇮🇩' },
  { code: '+60', country: 'ماليزيا', flag: '🇲🇾' },
  { code: '+98', country: 'إيران', flag: '🇮🇷' },
  { code: '+1', country: 'أمريكا', flag: '🇺🇸' },
  { code: '+44', country: 'بريطانيا', flag: '🇬🇧' },
  { code: '+33', country: 'فرنسا', flag: '🇫🇷' },
  { code: '+49', country: 'ألمانيا', flag: '🇩🇪' },
];

type TK =
  | 'appName' | 'appTagline' | 'login' | 'signup' | 'logout' | 'email' | 'password'
  | 'username' | 'phone' | 'birthDate' | 'gender' | 'male' | 'female' | 'country'
  | 'showPassword' | 'hidePassword' | 'forgotPassword' | 'recoverPassword'
  | 'loginMethod' | 'usernamePassword' | 'phoneDOB' | 'age' | 'language'
  | 'adminPanel' | 'userApp' | 'home' | 'favorites' | 'readLater' | 'difficult'
  | 'search' | 'allSurahs' | 'allStatus' | 'allTypes' | 'green' | 'red' | 'protected'
  | 'export' | 'loading' | 'noResults' | 'listen' | 'stop' | 'voiceSettings'
  | 'savePreference' | 'rephrase' | 'smartRephrase' | 'recordVoice' | 'useVerseText'
  | 'accept' | 'reject' | 'voiceEdit' | 'processing' | 'originalText' | 'rephrasedText'
  | 'addLink' | 'linkType' | 'linkUrl' | 'linkTitle' | 'save' | 'cancel' | 'delete'
  | 'editVerse' | 'protect' | 'unprotect' | 'verseNo' | 'surahName' | 'verseText'
  | 'progress' | 'withLinks' | 'withoutLinks' | 'protectedVerses' | 'remaining'
  | 'share' | 'shareVia' | 'qrCodes' | 'windowsStore' | 'appleStore' | 'googlePlay'
  | 'addTo' | 'welcomeBack' | 'createAccount' | 'signInSuccess' | 'signUpSuccess'
  | 'invalidCredentials' | 'passwordTooShort' | 'selectGender' | 'selectCountry'
  | 'enterUsername' | 'enterPhone' | 'enterBirthDate' | 'backToHome' | 'loginMethodSwitch'
  | 'totalVerses' | 'indexedVerses' | 'addToList' | 'removeFromList' | 'verse'
  | 'linksCount' | 'viewLinks' | 'noLinksYet' | 'filterByType' | 'surah'
  | 'indexed' | 'notIndexed' | 'poweredBy' | 'confirmDelete' | 'confirmDeleteVerse'
  | 'splashLoading' | 'myLists' | 'shareVerse' | 'copyLink';

type TR = Record<Lang, Record<TK, string>>;

export const T: TR = {
  ar: {
    appName: 'روابط الذكر الحكيم', appTagline: 'معك في كل آية، حتى نُتمّ حفظ كتاب الله',
    login: 'تسجيل الدخول', signup: 'إنشاء حساب', logout: 'خروج', email: 'البريد الإلكتروني',
    password: 'كلمة المرور', username: 'اسم المستخدم', phone: 'رقم الهاتف',
    birthDate: 'تاريخ الميلاد', gender: 'الجنس', male: 'ذكر', female: 'أنثى',
    country: 'الدولة', showPassword: 'إظهار', hidePassword: 'إخفاء',
    forgotPassword: 'نسيت كلمة المرور؟', recoverPassword: 'استرجاع كلمة المرور',
    loginMethod: 'طريقة الدخول', usernamePassword: 'اسم المستخدم وكلمة المرور',
    phoneDOB: 'رقم الهاتف وتاريخ الميلاد', age: 'العمر', language: 'اللغة',
    adminPanel: 'لوحة الإدارة', userApp: 'تطبيق المستخدم', home: 'الرئيسية',
    favorites: 'المفضلة', readLater: 'أرجع لها لاحقاً', difficult: 'صعبة',
    search: 'بحث', allSurahs: 'كل السور', allStatus: 'الكل', allTypes: 'كل الأنواع',
    green: 'أخضر', red: 'أحمر', protected: 'محمي', export: 'تصدير', loading: 'جارٍ التحميل...',
    noResults: 'لا توجد نتائج', listen: 'استماع', stop: 'إيقاف', voiceSettings: 'إعدادات الصوت',
    savePreference: 'حفظ التفضيل', rephrase: 'إعادة صياغة', smartRephrase: 'إعادة الصياغة الذكية',
    recordVoice: 'تسجيل صوتي', useVerseText: 'صياغة الآية', accept: 'قبول وحفظ', reject: 'رفض',
    voiceEdit: 'تعديل صوتي', processing: 'جارٍ المعالجة...', originalText: 'النص الأصلي',
    rephrasedText: 'النص المعاد صياغته', addLink: 'تسجيل رابط', linkType: 'نوع الرابط',
    linkUrl: 'الرابط', linkTitle: 'عنوان (اختياري)', save: 'حفظ', cancel: 'إلغاء', delete: 'حذف',
    editVerse: 'تعديل الآية', protect: 'حماية', unprotect: 'فك الحماية', verseNo: 'رقم الآية',
    surahName: 'اسم السورة', verseText: 'نص الآية', progress: 'تقدم إنشاء الروابط',
    withLinks: 'آيات بها روابط', withoutLinks: 'آيات بدون روابط', protectedVerses: 'آيات محمية',
    remaining: 'متبقية', share: 'مشاركة', shareVia: 'مشاركة عبر', qrCodes: 'رموز QR',
    windowsStore: 'متجر ويندوز', appleStore: 'متجر آبل', googlePlay: 'جوجل بلاي',
    addTo: 'إضافة إلى', welcomeBack: 'مرحباً بعودتك', createAccount: 'إنشاء حساب جديد',
    signInSuccess: 'تم تسجيل الدخول بنجاح', signUpSuccess: 'تم إنشاء الحساب بنجاح',
    invalidCredentials: 'بيانات الدخول غير صحيحة', passwordTooShort: 'كلمة المرور قصيرة جداً',
    selectGender: 'اختر الجنس', selectCountry: 'اختر الدولة', enterUsername: 'أدخل اسم المستخدم',
    enterPhone: 'أدخل رقم الهاتف', enterBirthDate: 'أدخل تاريخ الميلاد',
    backToHome: 'العودة للرئيسية', loginMethodSwitch: 'أو سجل دخول بـ',
    totalVerses: 'آية', indexedVerses: 'آية لها رابط', addToList: 'إضافة للقائمة',
    removeFromList: 'إزالة من القائمة', verse: 'آية', linksCount: 'رابط',
    viewLinks: 'عرض الروابط', noLinksYet: 'لا توجد روابط بعد', filterByType: 'فلترة بالنوع',
    surah: 'سورة', indexed: 'له رابط', notIndexed: 'بدون رابط', poweredBy: 'مدعوم بـ',
    confirmDelete: 'هل أنت متأكد؟', confirmDeleteVerse: 'هل أنت متأكد من حذف هذه الآية؟',
    splashLoading: 'جارٍ التحميل...', myLists: 'قوائمي', shareVerse: 'مشاركة الآية', copyLink: 'نسخ الرابط',
  },
  en: {
    appName: 'Thikr Links', appTagline: 'Quran Indexing Platform',
    login: 'Login', signup: 'Sign Up', logout: 'Logout', email: 'Email',
    password: 'Password', username: 'Username', phone: 'Phone Number',
    birthDate: 'Date of Birth', gender: 'Gender', male: 'Male', female: 'Female',
    country: 'Country', showPassword: 'Show', hidePassword: 'Hide',
    forgotPassword: 'Forgot password?', recoverPassword: 'Recover password',
    loginMethod: 'Login method', usernamePassword: 'Username & Password',
    phoneDOB: 'Phone & Date of Birth', age: 'Age', language: 'Language',
    adminPanel: 'Admin Panel', userApp: 'User App', home: 'Home',
    favorites: 'Favorites', readLater: 'Read Later', difficult: 'Difficult',
    search: 'Search', allSurahs: 'All Surahs', allStatus: 'All', allTypes: 'All Types',
    green: 'Green', red: 'Red', protected: 'Protected', export: 'Export', loading: 'Loading...',
    noResults: 'No results', listen: 'Listen', stop: 'Stop', voiceSettings: 'Voice Settings',
    savePreference: 'Save', rephrase: 'Rephrase', smartRephrase: 'Smart Rephrase',
    recordVoice: 'Record voice', useVerseText: 'Use verse text', accept: 'Accept & Save', reject: 'Reject',
    voiceEdit: 'Voice edit', processing: 'Processing...', originalText: 'Original text',
    rephrasedText: 'Rephrased text', addLink: 'Add link', linkType: 'Link type',
    linkUrl: 'URL', linkTitle: 'Title (optional)', save: 'Save', cancel: 'Cancel', delete: 'Delete',
    editVerse: 'Edit verse', protect: 'Protect', unprotect: 'Unprotect', verseNo: 'Verse No.',
    surahName: 'Surah name', verseText: 'Verse text', progress: 'Indexing progress',
    withLinks: 'With links', withoutLinks: 'Without links', protectedVerses: 'Protected verses',
    remaining: 'remaining', share: 'Share', shareVia: 'Share via', qrCodes: 'QR Codes',
    windowsStore: 'Windows Store', appleStore: 'Apple Store', googlePlay: 'Google Play',
    addTo: 'Add to', welcomeBack: 'Welcome back', createAccount: 'Create new account',
    signInSuccess: 'Login successful', signUpSuccess: 'Account created successfully',
    invalidCredentials: 'Invalid credentials', passwordTooShort: 'Password too short',
    selectGender: 'Select gender', selectCountry: 'Select country', enterUsername: 'Enter username',
    enterPhone: 'Enter phone number', enterBirthDate: 'Enter date of birth',
    backToHome: 'Back to home', loginMethodSwitch: 'Or login with',
    totalVerses: 'verses', indexedVerses: 'indexed verses', addToList: 'Add to list',
    removeFromList: 'Remove from list', verse: 'verse', linksCount: 'links',
    viewLinks: 'View links', noLinksYet: 'No links yet', filterByType: 'Filter by type',
    surah: 'Surah', indexed: 'Indexed', notIndexed: 'Not indexed', poweredBy: 'Powered by',
    confirmDelete: 'Are you sure?', confirmDeleteVerse: 'Delete this verse?',
    splashLoading: 'Loading...', myLists: 'My Lists', shareVerse: 'Share verse', copyLink: 'Copy link',
  },
  fr: {
    appName: 'Liens du Thikr', appTagline: 'Plateforme d\'indexation du Coran',
    login: 'Connexion', signup: 'Inscription', logout: 'Déconnexion', email: 'Email',
    password: 'Mot de passe', username: 'Nom d\'utilisateur', phone: 'Téléphone',
    birthDate: 'Date de naissance', gender: 'Genre', male: 'Homme', female: 'Femme',
    country: 'Pays', showPassword: 'Afficher', hidePassword: 'Masquer',
    forgotPassword: 'Mot de passe oublié?', recoverPassword: 'Récupérer',
    loginMethod: 'Méthode', usernamePassword: 'Nom & mot de passe',
    phoneDOB: 'Téléphone & naissance', age: 'Âge', language: 'Langue',
    adminPanel: 'Admin', userApp: 'App', home: 'Accueil',
    favorites: 'Favoris', readLater: 'Plus tard', difficult: 'Difficile',
    search: 'Rechercher', allSurahs: 'Toutes sourates', allStatus: 'Tous', allTypes: 'Tous types',
    green: 'Vert', red: 'Rouge', protected: 'Protégé', export: 'Exporter', loading: 'Chargement...',
    noResults: 'Aucun résultat', listen: 'Écouter', stop: 'Arrêter', voiceSettings: 'Voix',
    savePreference: 'Enregistrer', rephrase: 'Reformuler', smartRephrase: 'Reformulation',
    recordVoice: 'Enregistrer', useVerseText: 'Texte verset', accept: 'Accepter', reject: 'Rejeter',
    voiceEdit: 'Édition vocale', processing: 'Traitement...', originalText: 'Texte original',
    rephrasedText: 'Texte reformulé', addLink: 'Ajouter lien', linkType: 'Type',
    linkUrl: 'URL', linkTitle: 'Titre', save: 'Enregistrer', cancel: 'Annuler', delete: 'Supprimer',
    editVerse: 'Éditer', protect: 'Protéger', unprotect: 'Déprotéger', verseNo: 'No.',
    surahName: 'Sourate', verseText: 'Texte', progress: 'Progression',
    withLinks: 'Avec liens', withoutLinks: 'Sans liens', protectedVerses: 'Protégés',
    remaining: 'restants', share: 'Partager', shareVia: 'Partager via', qrCodes: 'Codes QR',
    windowsStore: 'Windows', appleStore: 'Apple', googlePlay: 'Google Play',
    addTo: 'Ajouter à', welcomeBack: 'Bon retour', createAccount: 'Créer compte',
    signInSuccess: 'Connexion réussie', signUpSuccess: 'Compte créé',
    invalidCredentials: 'Identifiants invalides', passwordTooShort: 'Mot de passe court',
    selectGender: 'Genre', selectCountry: 'Pays', enterUsername: 'Nom d\'utilisateur',
    enterPhone: 'Téléphone', enterBirthDate: 'Date de naissance',
    backToHome: 'Accueil', loginMethodSwitch: 'Ou avec',
    totalVerses: 'versets', indexedVerses: 'indexés', addToList: 'Ajouter',
    removeFromList: 'Retirer', verse: 'verset', linksCount: 'liens',
    viewLinks: 'Voir liens', noLinksYet: 'Pas de liens', filterByType: 'Filtrer',
    surah: 'Sourate', indexed: 'Indexé', notIndexed: 'Non indexé', poweredBy: 'Propulsé par',
    confirmDelete: 'Sûr?', confirmDeleteVerse: 'Supprimer?',
    splashLoading: 'Chargement...', myLists: 'Mes listes', shareVerse: 'Partager', copyLink: 'Copier',
  },
  ur: { appName: 'ذکر کے روابط', appTagline: 'قرآن فہرست نگاری پلیٹ فارم', login: 'لاگ ان', signup: 'اکاؤنٹ بنائیں', logout: 'لاگ آؤٹ', email: 'ای میل', password: 'پاس ورڈ', username: 'صارف نام', phone: 'فون نمبر', birthDate: 'پیدائش کی تاریخ', gender: 'جنس', male: 'مرد', female: 'عورت', country: 'ملک', showPassword: 'دکھائیں', hidePassword: 'چھپائیں', forgotPassword: 'پاس ورڈ بھول گئے؟', recoverPassword: 'پاس ورڈ بحال', loginMethod: 'طریقہ', usernamePassword: 'نام اور پاس ورڈ', phoneDOB: 'فون اور پیدائش', age: 'عمر', language: 'زبان', adminPanel: 'ایڈمن', userApp: 'ایپ', home: 'ہوم', favorites: 'پسندیدہ', readLater: 'بعد میں', difficult: 'مشکل', search: 'تلاش', allSurahs: 'تمام سورتیں', allStatus: 'تمام', allTypes: 'تمام اقسام', green: 'سبز', red: 'لال', protected: 'محفوظ', export: 'برآمد', loading: 'لوڈ...', noResults: 'کوئی نتائج نہیں', listen: 'سننا', stop: 'روکیں', voiceSettings: 'آواز', savePreference: 'محفوظ', rephrase: 'دوبارہ بیان', smartRephrase: 'ذہین بیان', recordVoice: 'ریکارڈ', useVerseText: 'آیت متن', accept: 'قبول', reject: 'رد', voiceEdit: 'آواز ترمیم', processing: 'پروسیسنگ...', originalText: 'اصل متن', rephrasedText: 'دوبارہ بیان', addLink: 'ربط شامل', linkType: 'قسم', linkUrl: 'URL', linkTitle: 'عنوان', save: 'محفوظ', cancel: 'منسوخ', delete: 'حذف', editVerse: 'ترمیم', protect: 'محفوظ', unprotect: 'غیر محفوظ', verseNo: 'آیت نمبر', surahName: 'سورت نام', verseText: 'آیت متن', progress: 'پیش رفت', withLinks: 'روابط ساتھ', withoutLinks: 'روابط بغیر', protectedVerses: 'محفوظ آیات', remaining: 'باقی', share: 'شیئر', shareVia: 'شیئر via', qrCodes: 'QR کوڈز', windowsStore: 'ونڈوز', appleStore: 'ایپل', googlePlay: 'گوگل پلے', addTo: 'شامل', welcomeBack: 'واپس خوش آمدید', createAccount: 'نیا اکاؤنٹ', signInSuccess: 'کامیاب', signUpSuccess: 'اکاؤنٹ بن گیا', invalidCredentials: 'غلط', passwordTooShort: 'پاس ورڈ مختصر', selectGender: 'جنس', selectCountry: 'ملک', enterUsername: 'نام', enterPhone: 'فون', enterBirthDate: 'تاریخ', backToHome: 'ہوم', loginMethodSwitch: 'یا', totalVerses: 'آیات', indexedVerses: 'فہرست شدہ', addToList: 'شامل', removeFromList: 'ہٹائیں', verse: 'آیت', linksCount: 'روابط', viewLinks: 'روابط', noLinksYet: 'کوئی روابط نہیں', filterByType: 'فلٹر', surah: 'سورت', indexed: 'فہرست شدہ', notIndexed: 'غیر فہرست', poweredBy: 'تقویت', confirmDelete: 'یقین؟', confirmDeleteVerse: 'حذف؟', splashLoading: 'لوڈ...', myLists: 'میری فہرستیں', shareVerse: 'شیئر', copyLink: 'کاپی' },
  tr: { appName: 'Zikir Bağlantıları', appTagline: 'Kur\'an İndeks Platformu', login: 'Giriş', signup: 'Kayıt', logout: 'Çıkış', email: 'E-posta', password: 'Şifre', username: 'Kullanıcı adı', phone: 'Telefon', birthDate: 'Doğum tarihi', gender: 'Cinsiyet', male: 'Erkek', female: 'Kadın', country: 'Ülke', showPassword: 'Göster', hidePassword: 'Gizle', forgotPassword: 'Şifremi unuttum', recoverPassword: 'Şifre kurtarma', loginMethod: 'Yöntem', usernamePassword: 'Kullanıcı adı ve şifre', phoneDOB: 'Telefon ve doğum', age: 'Yaş', language: 'Dil', adminPanel: 'Admin', userApp: 'Uygulama', home: 'Ana sayfa', favorites: 'Favoriler', readLater: 'Sonra oku', difficult: 'Zor', search: 'Ara', allSurahs: 'Tüm sureler', allStatus: 'Tümü', allTypes: 'Tüm türler', green: 'Yeşil', red: 'Kırmızı', protected: 'Korumalı', export: 'Dışa aktar', loading: 'Yükleniyor...', noResults: 'Sonuç yok', listen: 'Dinle', stop: 'Durdur', voiceSettings: 'Ses', savePreference: 'Kaydet', rephrase: 'Yeniden ifade', smartRephrase: 'Akıllı ifade', recordVoice: 'Kaydet', useVerseText: 'Ayet metni', accept: 'Kabul', reject: 'Reddet', voiceEdit: 'Sesli düzenleme', processing: 'İşleniyor...', originalText: 'Orijinal metin', rephrasedText: 'Yeniden ifade', addLink: 'Bağlantı ekle', linkType: 'Tür', linkUrl: 'URL', linkTitle: 'Başlık', save: 'Kaydet', cancel: 'İptal', delete: 'Sil', editVerse: 'Düzenle', protect: 'Koru', unprotect: 'Korumayı kaldır', verseNo: 'Ayet no', surahName: 'Sure adı', verseText: 'Ayet metni', progress: 'İlerleme', withLinks: 'Bağlantılı', withoutLinks: 'Bağlantısız', protectedVerses: 'Korumalı ayetler', remaining: 'kalan', share: 'Paylaş', shareVia: 'Paylaş via', qrCodes: 'QR kodları', windowsStore: 'Windows', appleStore: 'Apple', googlePlay: 'Google Play', addTo: 'Ekle', welcomeBack: 'Hoş geldiniz', createAccount: 'Hesap oluştur', signInSuccess: 'Giriş başarılı', signUpSuccess: 'Hesap oluşturuldu', invalidCredentials: 'Geçersiz', passwordTooShort: 'Şifre kısa', selectGender: 'Cinsiyet', selectCountry: 'Ülke', enterUsername: 'Kullanıcı adı', enterPhone: 'Telefon', enterBirthDate: 'Doğum tarihi', backToHome: 'Ana sayfa', loginMethodSwitch: 'Veya', totalVerses: 'ayet', indexedVerses: 'indekslenmiş', addToList: 'Listeye ekle', removeFromList: 'Çıkar', verse: 'ayet', linksCount: 'bağlantı', viewLinks: 'Bağlantıları gör', noLinksYet: 'Bağlantı yok', filterByType: 'Filtrele', surah: 'Sure', indexed: 'İndeksli', notIndexed: 'İndekssiz', poweredBy: 'Geliştiren', confirmDelete: 'Emin?', confirmDeleteVerse: 'Sil?', splashLoading: 'Yükleniyor...', myLists: 'Listelerim', shareVerse: 'Paylaş', copyLink: 'Kopyala' },
  fa: { appName: 'پیوندهای ذکر', appTagline: 'پلتفرم فهرست‌بندی قرآن', login: 'ورود', signup: 'ثبت‌نام', logout: 'خروج', email: 'ایمیل', password: 'رمز عبور', username: 'نام کاربری', phone: 'تلفن', birthDate: 'تاریخ تولد', gender: 'جنسیت', male: 'مرد', female: 'زن', country: 'کشور', showPassword: 'نمایش', hidePassword: 'پنهان', forgotPassword: 'فراموش کردید؟', recoverPassword: 'بازیابی', loginMethod: 'روش', usernamePassword: 'نام کاربری و رمز', phoneDOB: 'تلفن و تولد', age: 'سن', language: 'زبان', adminPanel: 'مدیریت', userApp: 'برنامه', home: 'خانه', favorites: 'علاقه‌مندی', readLater: 'بعداً', difficult: 'سخت', search: 'جستجو', allSurahs: 'همه سوره‌ها', allStatus: 'همه', allTypes: 'همه انواع', green: 'سبز', red: 'قرمز', protected: 'محافظت‌شده', export: 'خروجی', loading: 'بارگذاری...', noResults: 'نتیجه‌ای نیست', listen: 'گوش', stop: 'توقف', voiceSettings: 'صدا', savePreference: 'ذخیره', rephrase: 'بازنویسی', smartRephrase: 'بازنویسی هوشمند', recordVoice: 'ضبط', useVerseText: 'متن آیه', accept: 'قبول', reject: 'رد', voiceEdit: 'ویرایش صوتی', processing: 'پردازش...', originalText: 'متن اصلی', rephrasedText: 'بازنویسی', addLink: 'افزودن پیوند', linkType: 'نوع', linkUrl: 'URL', linkTitle: 'عنوان', save: 'ذخیره', cancel: 'لغو', delete: 'حذف', editVerse: 'ویرایش', protect: 'محافظت', unprotect: 'رفع', verseNo: 'شماره آیه', surahName: 'نام سوره', verseText: 'متن آیه', progress: 'پیشرفت', withLinks: 'با پیوند', withoutLinks: 'بدون پیوند', protectedVerses: 'محافظت‌شده', remaining: 'باقی', share: 'اشتراک', shareVia: 'اشتراک via', qrCodes: 'کدهای QR', windowsStore: 'ویندوز', appleStore: 'اپل', googlePlay: 'گوگل پلی', addTo: 'افزودن', welcomeBack: 'خوش آمدید', createAccount: 'ساخت حساب', signInSuccess: 'ورود موفق', signUpSuccess: 'حساب ساخته شد', invalidCredentials: 'نادرست', passwordTooShort: 'رمز کوتاه', selectGender: 'جنسیت', selectCountry: 'کشور', enterUsername: 'نام کاربری', enterPhone: 'تلفن', enterBirthDate: 'تاریخ تولد', backToHome: 'بازگشت', loginMethodSwitch: 'یا', totalVerses: 'آیه', indexedVerses: 'فهرست‌شده', addToList: 'افزودن', removeFromList: 'حذف', verse: 'آیه', linksCount: 'پیوند', viewLinks: 'مشاهده', noLinksYet: 'پیوندی نیست', filterByType: 'فیلتر', surah: 'سوره', indexed: 'فهرست‌شده', notIndexed: 'نشده', poweredBy: 'پشتیبانی', confirmDelete: 'مطمئن؟', confirmDeleteVerse: 'حذف؟', splashLoading: 'بارگذاری...', myLists: 'لیست‌های من', shareVerse: 'اشتراک', copyLink: 'کپی' },
  id: { appName: 'Tautan Zikir', appTagline: 'Platform Indeks Al-Qur\'an', login: 'Masuk', signup: 'Daftar', logout: 'Keluar', email: 'Email', password: 'Kata sandi', username: 'Nama pengguna', phone: 'Telepon', birthDate: 'Tanggal lahir', gender: 'Jenis kelamin', male: 'Laki-laki', female: 'Perempuan', country: 'Negara', showPassword: 'Tampilkan', hidePassword: 'Sembunyikan', forgotPassword: 'Lupa sandi?', recoverPassword: 'Pulihkan', loginMethod: 'Metode', usernamePassword: 'Nama & sandi', phoneDOB: 'Telepon & lahir', age: 'Usia', language: 'Bahasa', adminPanel: 'Admin', userApp: 'Aplikasi', home: 'Beranda', favorites: 'Favorit', readLater: 'Nanti', difficult: 'Sulit', search: 'Cari', allSurahs: 'Semua surah', allStatus: 'Semua', allTypes: 'Semua jenis', green: 'Hijau', red: 'Merah', protected: 'Dilindungi', export: 'Ekspor', loading: 'Memuat...', noResults: 'Tidak ada hasil', listen: 'Dengar', stop: 'Berhenti', voiceSettings: 'Suara', savePreference: 'Simpan', rephrase: 'Parafrase', smartRephrase: 'Parafrase cerdas', recordVoice: 'Rekam', useVerseText: 'Teks ayat', accept: 'Terima', reject: 'Tolak', voiceEdit: 'Edit suara', processing: 'Memproses...', originalText: 'Teks asli', rephrasedText: 'Parafrase', addLink: 'Tambah tautan', linkType: 'Jenis', linkUrl: 'URL', linkTitle: 'Judul', save: 'Simpan', cancel: 'Batal', delete: 'Hapus', editVerse: 'Edit', protect: 'Lindungi', unprotect: 'Buka', verseNo: 'No. ayat', surahName: 'Nama surah', verseText: 'Teks ayat', progress: 'Kemajuan', withLinks: 'Dengan tautan', withoutLinks: 'Tanpa', protectedVerses: 'Dilindungi', remaining: 'tersisa', share: 'Bagikan', shareVia: 'Bagikan via', qrCodes: 'Kode QR', windowsStore: 'Windows', appleStore: 'Apple', googlePlay: 'Google Play', addTo: 'Tambah ke', welcomeBack: 'Selamat datang', createAccount: 'Buat akun', signInSuccess: 'Berhasil masuk', signUpSuccess: 'Akun dibuat', invalidCredentials: 'Salah', passwordTooShort: 'Sandi pendek', selectGender: 'Pilih', selectCountry: 'Pilih', enterUsername: 'Nama pengguna', enterPhone: 'Telepon', enterBirthDate: 'Tanggal lahir', backToHome: 'Kembali', loginMethodSwitch: 'Atau', totalVerses: 'ayat', indexedVerses: 'terindeks', addToList: 'Tambah', removeFromList: 'Hapus', verse: 'ayat', linksCount: 'tautan', viewLinks: 'Lihat tautan', noLinksYet: 'Belum ada', filterByType: 'Filter', surah: 'Surah', indexed: 'Terindeks', notIndexed: 'Belum', poweredBy: 'Didukung', confirmDelete: 'Yakin?', confirmDeleteVerse: 'Hapus?', splashLoading: 'Memuat...', myLists: 'Daftar saya', shareVerse: 'Bagikan', copyLink: 'Salin' },
  bn: { appName: 'জিকির লিংক', appTagline: 'কুরআন ইনডেক্সিং প্ল্যাটফর্ম', login: 'লগইন', signup: 'নিবন্ধন', logout: 'লগআউট', email: 'ইমেইল', password: 'পাসওয়ার্ড', username: 'ব্যবহারকারী নাম', phone: 'ফোন', birthDate: 'জন্ম তারিখ', gender: 'লিঙ্গ', male: 'পুরুষ', female: 'মহিলা', country: 'দেশ', showPassword: 'দেখান', hidePassword: 'লুকান', forgotPassword: 'ভুলেছেন?', recoverPassword: 'পুনরুদ্ধার', loginMethod: 'পদ্ধতি', usernamePassword: 'নাম ও পাসওয়ার্ড', phoneDOB: 'ফোন ও জন্ম', age: 'বয়স', language: 'ভাষা', adminPanel: 'অ্যাডমিন', userApp: 'অ্যাপ', home: 'হোম', favorites: 'প্রিয়', readLater: 'পরে', difficult: 'কঠিন', search: 'অনুসন্ধান', allSurahs: 'সব সূরা', allStatus: 'সব', allTypes: 'সব ধরন', green: 'সবুজ', red: 'লাল', protected: 'সুরক্ষিত', export: 'রপ্তানি', loading: 'লোড...', noResults: 'কোন ফলাফল', listen: 'শুনুন', stop: 'থামুন', voiceSettings: 'ভয়েস', savePreference: 'সংরক্ষণ', rephrase: 'পুনরায় লিখুন', smartRephrase: 'স্মার্ট লিখুন', recordVoice: 'রেকর্ড', useVerseText: 'আয়াত লিখুন', accept: 'গ্রহণ', reject: 'প্রত্যাখ্যান', voiceEdit: 'ভয়েস সম্পাদনা', processing: 'প্রক্রিয়াধীন...', originalText: 'মূল পাঠ্য', rephrasedText: 'পুনরায় লিখিত', addLink: 'লিংক যোগ', linkType: 'প্রকার', linkUrl: 'URL', linkTitle: 'শিরোনাম', save: 'সংরক্ষণ', cancel: 'বাতিল', delete: 'মুছুন', editVerse: 'সম্পাদনা', protect: 'সুরক্ষা', unprotect: 'সরান', verseNo: 'আয়াত নং', surahName: 'সূরা নাম', verseText: 'আয়াত পাঠ্য', progress: 'অগ্রগতি', withLinks: 'লিংক সহ', withoutLinks: 'ছাড়া', protectedVerses: 'সুরক্ষিত', remaining: 'অবশিষ্ট', share: 'শেয়ার', shareVia: 'শেয়ার via', qrCodes: 'QR কোড', windowsStore: 'উইন্ডোজ', appleStore: 'অ্যাপল', googlePlay: 'গুগল প্লে', addTo: 'যোগ করুন', welcomeBack: 'ফিরে এসেছেন', createAccount: 'নতুন অ্যাকাউন্ট', signInSuccess: 'সফল', signUpSuccess: 'তৈরি', invalidCredentials: 'ভুল', passwordTooShort: 'ছোট', selectGender: 'নির্বাচন', selectCountry: 'নির্বাচন', enterUsername: 'নাম', enterPhone: 'ফোন', enterBirthDate: 'তারিখ', backToHome: 'হোম', loginMethodSwitch: 'বা', totalVerses: 'আয়াত', indexedVerses: 'ইনডেক্সকৃত', addToList: 'যোগ', removeFromList: 'সরান', verse: 'আয়াত', linksCount: 'লিংক', viewLinks: 'লিংক দেখুন', noLinksYet: 'কোন লিংক নেই', filterByType: 'ফিল্টার', surah: 'সূরা', indexed: 'ইনডেক্সকৃত', notIndexed: 'অনিনডেক্স', poweredBy: 'চালিত', confirmDelete: 'নিশ্চিত?', confirmDeleteVerse: 'মুছবেন?', splashLoading: 'লোড...', myLists: 'আমার তালিকা', shareVerse: 'শেয়ার', copyLink: 'কপি' },
};
