/* Snipoclip i18n + currency engine (shared, no build step).
   Usage: data-i18n="key" sets textContent; data-i18n-ph="key" sets placeholder.
   t('key', {name:'x'}) for interpolation. Persists choice in localStorage. */
(function (w) {
  const DICT = {
    en: {
      _name: 'English', _dir: 'ltr',
      nav_create: 'Create', nav_clips: 'My clips', nav_upgrade: 'Upgrade', nav_settings: 'Settings',
      signout: 'Sign out',
      create_title: 'Turn one video into viral clips',
      create_sub: 'Upload a video or paste a link. The AI finds the best moments and cuts them into captioned vertical clips.',
      tab_upload: 'Upload file', tab_url: 'Paste link',
      drop: 'Drop a video here, or click to choose', drop_hint: 'MP4, MOV or WebM · up to 1GB',
      url_ph: 'https://youtube.com/watch?v=…',
      generate: 'Generate clips', generating: 'Starting…',
      jobs_title: 'Processing', jobs_empty: 'Nothing processing right now.',
      clips_title: 'Your clips', clips_sub: 'Sorted by virality score.', clips_empty: 'Your clips will appear here.',
      download: 'Download', copy_caption: 'Copy caption', copied: 'Copied',
      stage_queued: 'Queued', stage_fetching: 'Fetching video', stage_transcribing: 'Transcribing',
      stage_selecting: 'Finding best moments', stage_rendering: 'Rendering clips', stage_done: 'Done', stage_error: 'Failed',
      quota_left: '{n} clips left', quota_unlimited: 'Unlimited', quota_trial: 'Free trial · {n} of {limit} used',
      wall_title: 'You\u2019ve used your 2 free clips', wall_sub: 'Upgrade to keep turning long videos into scroll-stopping shorts.',
      upgrade_title: 'Choose your plan', upgrade_sub: 'Cancel anytime. Prices update to your currency.',
      billing_month: 'Monthly', billing_year: 'Yearly', save20: 'Save ~20%',
      per_month: '/mo', per_year: '/yr', current_plan: 'Current plan', choose: 'Choose {plan}', most_popular: 'Most popular',
      settings_title: 'Settings', set_lang: 'Language', set_currency: 'Currency', set_caption: 'Caption style',
      set_account: 'Account', set_plan: 'Plan', cap_bold: 'Bold (default)', cap_minimal: 'Minimal', cap_karaoke: 'Word-by-word',
      err_choose_file: 'Choose a video file first', err_paste_url: 'Paste a video URL first',
      job_started: 'Job started — your clips will appear below shortly.', err_generic: 'Something went wrong. Try again.',
      checkout_soon: 'Checkout for {plan} isn\u2019t live yet — payment keys still needed.', uploaded_video: 'Uploaded video'
    },
    hi: {
      _name: 'हिन्दी', _dir: 'ltr',
      nav_create: 'बनाएँ', nav_clips: 'मेरी क्लिप्स', nav_upgrade: 'अपग्रेड', nav_settings: 'सेटिंग्स',
      signout: 'साइन आउट',
      create_title: 'एक वीडियो से वायरल क्लिप्स बनाएँ',
      create_sub: 'वीडियो अपलोड करें या लिंक पेस्ट करें। AI सबसे अच्छे पल चुनकर कैप्शन वाली वर्टिकल क्लिप्स बनाता है।',
      tab_upload: 'फ़ाइल अपलोड', tab_url: 'लिंक पेस्ट करें',
      drop: 'वीडियो यहाँ छोड़ें, या चुनने के लिए क्लिक करें', drop_hint: 'MP4, MOV या WebM · 1GB तक',
      url_ph: 'https://youtube.com/watch?v=…',
      generate: 'क्लिप्स बनाएँ', generating: 'शुरू हो रहा है…',
      jobs_title: 'प्रोसेसिंग', jobs_empty: 'अभी कुछ प्रोसेस नहीं हो रहा।',
      clips_title: 'आपकी क्लिप्स', clips_sub: 'वायरलिटी स्कोर के अनुसार।', clips_empty: 'आपकी क्लिप्स यहाँ दिखेंगी।',
      download: 'डाउनलोड', copy_caption: 'कैप्शन कॉपी करें', copied: 'कॉपी हो गया',
      stage_queued: 'कतार में', stage_fetching: 'वीडियो ला रहे हैं', stage_transcribing: 'ट्रांसक्राइब हो रहा',
      stage_selecting: 'बेहतरीन पल चुन रहे', stage_rendering: 'क्लिप्स रेंडर हो रहीं', stage_done: 'पूर्ण', stage_error: 'विफल',
      quota_left: '{n} क्लिप्स बाकी', quota_unlimited: 'असीमित', quota_trial: 'फ्री ट्रायल · {limit} में से {n} उपयोग',
      wall_title: 'आपने अपनी 2 फ्री क्लिप्स इस्तेमाल कर लीं', wall_sub: 'लंबे वीडियो को शॉर्ट्स में बदलते रहने के लिए अपग्रेड करें।',
      upgrade_title: 'अपना प्लान चुनें', upgrade_sub: 'कभी भी रद्द करें। कीमतें आपकी मुद्रा में।',
      billing_month: 'मासिक', billing_year: 'वार्षिक', save20: '~20% बचाएँ',
      per_month: '/माह', per_year: '/वर्ष', current_plan: 'मौजूदा प्लान', choose: '{plan} चुनें', most_popular: 'सबसे लोकप्रिय',
      settings_title: 'सेटिंग्स', set_lang: 'भाषा', set_currency: 'मुद्रा', set_caption: 'कैप्शन शैली',
      set_account: 'खाता', set_plan: 'प्लान', cap_bold: 'बोल्ड (डिफ़ॉल्ट)', cap_minimal: 'सरल', cap_karaoke: 'शब्द-दर-शब्द',
      err_choose_file: 'पहले वीडियो फ़ाइल चुनें', err_paste_url: 'पहले वीडियो URL पेस्ट करें',
      job_started: 'जॉब शुरू — आपकी क्लिप्स जल्द नीचे दिखेंगी।', err_generic: 'कुछ गलत हुआ। फिर कोशिश करें।',
      checkout_soon: '{plan} के लिए चेकआउट अभी लाइव नहीं — पेमेंट कीज़ चाहिए।', uploaded_video: 'अपलोड किया वीडियो'
    },
    es: {
      _name: 'Español', _dir: 'ltr',
      nav_create: 'Crear', nav_clips: 'Mis clips', nav_upgrade: 'Mejorar', nav_settings: 'Ajustes',
      signout: 'Cerrar sesión',
      create_title: 'Convierte un video en clips virales',
      create_sub: 'Sube un video o pega un enlace. La IA encuentra los mejores momentos y los corta en clips verticales con subtítulos.',
      tab_upload: 'Subir archivo', tab_url: 'Pegar enlace',
      drop: 'Suelta un video aquí o haz clic para elegir', drop_hint: 'MP4, MOV o WebM · hasta 1GB',
      url_ph: 'https://youtube.com/watch?v=…',
      generate: 'Generar clips', generating: 'Iniciando…',
      jobs_title: 'Procesando', jobs_empty: 'Nada en proceso ahora.',
      clips_title: 'Tus clips', clips_sub: 'Ordenados por puntuación viral.', clips_empty: 'Tus clips aparecerán aquí.',
      download: 'Descargar', copy_caption: 'Copiar título', copied: 'Copiado',
      stage_queued: 'En cola', stage_fetching: 'Obteniendo video', stage_transcribing: 'Transcribiendo',
      stage_selecting: 'Buscando momentos', stage_rendering: 'Renderizando clips', stage_done: 'Listo', stage_error: 'Error',
      quota_left: '{n} clips restantes', quota_unlimited: 'Ilimitado', quota_trial: 'Prueba gratis · {n} de {limit} usados',
      wall_title: 'Usaste tus 2 clips gratis', wall_sub: 'Mejora para seguir creando shorts irresistibles.',
      upgrade_title: 'Elige tu plan', upgrade_sub: 'Cancela cuando quieras. Precios en tu moneda.',
      billing_month: 'Mensual', billing_year: 'Anual', save20: 'Ahorra ~20%',
      per_month: '/mes', per_year: '/año', current_plan: 'Plan actual', choose: 'Elegir {plan}', most_popular: 'Más popular',
      settings_title: 'Ajustes', set_lang: 'Idioma', set_currency: 'Moneda', set_caption: 'Estilo de subtítulos',
      set_account: 'Cuenta', set_plan: 'Plan', cap_bold: 'Negrita (predet.)', cap_minimal: 'Minimalista', cap_karaoke: 'Palabra por palabra',
      err_choose_file: 'Elige un archivo de video', err_paste_url: 'Pega una URL de video',
      job_started: 'Trabajo iniciado: tus clips aparecerán abajo pronto.', err_generic: 'Algo salió mal. Inténtalo de nuevo.',
      checkout_soon: 'El pago de {plan} aún no está activo — faltan claves de pago.', uploaded_video: 'Video subido'
    },
    pt: {
      _name: 'Português', _dir: 'ltr',
      nav_create: 'Criar', nav_clips: 'Meus clipes', nav_upgrade: 'Assinar', nav_settings: 'Ajustes',
      signout: 'Sair',
      create_title: 'Transforme um vídeo em clipes virais',
      create_sub: 'Envie um vídeo ou cole um link. A IA acha os melhores momentos e gera clipes verticais com legendas.',
      tab_upload: 'Enviar arquivo', tab_url: 'Colar link',
      drop: 'Solte um vídeo aqui ou clique para escolher', drop_hint: 'MP4, MOV ou WebM · até 1GB',
      url_ph: 'https://youtube.com/watch?v=…',
      generate: 'Gerar clipes', generating: 'Iniciando…',
      jobs_title: 'Processando', jobs_empty: 'Nada processando agora.',
      clips_title: 'Seus clipes', clips_sub: 'Ordenados por pontuação viral.', clips_empty: 'Seus clipes aparecerão aqui.',
      download: 'Baixar', copy_caption: 'Copiar legenda', copied: 'Copiado',
      stage_queued: 'Na fila', stage_fetching: 'Buscando vídeo', stage_transcribing: 'Transcrevendo',
      stage_selecting: 'Achando momentos', stage_rendering: 'Renderizando', stage_done: 'Pronto', stage_error: 'Falhou',
      quota_left: '{n} clipes restantes', quota_unlimited: 'Ilimitado', quota_trial: 'Teste grátis · {n} de {limit} usados',
      wall_title: 'Você usou seus 2 clipes grátis', wall_sub: 'Assine para continuar criando shorts irresistíveis.',
      upgrade_title: 'Escolha seu plano', upgrade_sub: 'Cancele quando quiser. Preços na sua moeda.',
      billing_month: 'Mensal', billing_year: 'Anual', save20: 'Economize ~20%',
      per_month: '/mês', per_year: '/ano', current_plan: 'Plano atual', choose: 'Escolher {plan}', most_popular: 'Mais popular',
      settings_title: 'Ajustes', set_lang: 'Idioma', set_currency: 'Moeda', set_caption: 'Estilo de legenda',
      set_account: 'Conta', set_plan: 'Plano', cap_bold: 'Negrito (padrão)', cap_minimal: 'Minimalista', cap_karaoke: 'Palavra a palavra',
      err_choose_file: 'Escolha um arquivo de vídeo', err_paste_url: 'Cole uma URL de vídeo',
      job_started: 'Tarefa iniciada — seus clipes aparecerão abaixo em breve.', err_generic: 'Algo deu errado. Tente novamente.',
      checkout_soon: 'O pagamento do {plan} ainda não está ativo — faltam chaves.', uploaded_video: 'Vídeo enviado'
    },
    fr: {
      _name: 'Français', _dir: 'ltr',
      nav_create: 'Créer', nav_clips: 'Mes clips', nav_upgrade: 'Passer au pro', nav_settings: 'Réglages',
      signout: 'Déconnexion',
      create_title: 'Transformez une vidéo en clips viraux',
      create_sub: 'Importez une vidéo ou collez un lien. L\u2019IA trouve les meilleurs moments et crée des clips verticaux sous-titrés.',
      tab_upload: 'Importer', tab_url: 'Coller un lien',
      drop: 'Déposez une vidéo ici, ou cliquez', drop_hint: 'MP4, MOV ou WebM · jusqu\u2019à 1 Go',
      url_ph: 'https://youtube.com/watch?v=…',
      generate: 'Générer les clips', generating: 'Démarrage…',
      jobs_title: 'Traitement', jobs_empty: 'Rien en cours.',
      clips_title: 'Vos clips', clips_sub: 'Triés par score viral.', clips_empty: 'Vos clips apparaîtront ici.',
      download: 'Télécharger', copy_caption: 'Copier la légende', copied: 'Copié',
      stage_queued: 'En file', stage_fetching: 'Récupération', stage_transcribing: 'Transcription',
      stage_selecting: 'Recherche des moments', stage_rendering: 'Rendu des clips', stage_done: 'Terminé', stage_error: 'Échec',
      quota_left: '{n} clips restants', quota_unlimited: 'Illimité', quota_trial: 'Essai gratuit · {n} sur {limit} utilisés',
      wall_title: 'Vous avez utilisé vos 2 clips gratuits', wall_sub: 'Passez au pro pour continuer à créer des shorts.',
      upgrade_title: 'Choisissez votre offre', upgrade_sub: 'Annulez à tout moment. Prix dans votre devise.',
      billing_month: 'Mensuel', billing_year: 'Annuel', save20: '~20% d\u2019économie',
      per_month: '/mois', per_year: '/an', current_plan: 'Offre actuelle', choose: 'Choisir {plan}', most_popular: 'Le plus choisi',
      settings_title: 'Réglages', set_lang: 'Langue', set_currency: 'Devise', set_caption: 'Style des sous-titres',
      set_account: 'Compte', set_plan: 'Offre', cap_bold: 'Gras (défaut)', cap_minimal: 'Minimal', cap_karaoke: 'Mot par mot',
      err_choose_file: 'Choisissez une vidéo', err_paste_url: 'Collez une URL de vidéo',
      job_started: 'Tâche lancée — vos clips apparaîtront bientôt ci-dessous.', err_generic: 'Une erreur est survenue. Réessayez.',
      checkout_soon: 'Le paiement {plan} n\u2019est pas encore actif — clés manquantes.', uploaded_video: 'Vidéo importée'
    },
    ar: {
      _name: 'العربية', _dir: 'rtl',
      nav_create: 'إنشاء', nav_clips: 'مقاطعي', nav_upgrade: 'ترقية', nav_settings: 'الإعدادات',
      signout: 'تسجيل الخروج',
      create_title: 'حوّل فيديو واحداً إلى مقاطع رائجة',
      create_sub: 'ارفع فيديو أو الصق رابطاً. يجد الذكاء الاصطناعي أفضل اللحظات ويقصّها إلى مقاطع عمودية مع ترجمة.',
      tab_upload: 'رفع ملف', tab_url: 'لصق رابط',
      drop: 'أفلت فيديو هنا أو انقر للاختيار', drop_hint: 'MP4 أو MOV أو WebM · حتى 1 غيغابايت',
      url_ph: 'https://youtube.com/watch?v=…',
      generate: 'إنشاء المقاطع', generating: 'جارٍ البدء…',
      jobs_title: 'قيد المعالجة', jobs_empty: 'لا شيء قيد المعالجة الآن.',
      clips_title: 'مقاطعك', clips_sub: 'مرتبة حسب درجة الانتشار.', clips_empty: 'ستظهر مقاطعك هنا.',
      download: 'تنزيل', copy_caption: 'نسخ العنوان', copied: 'تم النسخ',
      stage_queued: 'في الطابور', stage_fetching: 'جلب الفيديو', stage_transcribing: 'تفريغ النص',
      stage_selecting: 'إيجاد أفضل اللحظات', stage_rendering: 'تصيير المقاطع', stage_done: 'تم', stage_error: 'فشل',
      quota_left: 'تبقّى {n} مقاطع', quota_unlimited: 'غير محدود', quota_trial: 'تجربة مجانية · {n} من {limit}',
      wall_title: 'استخدمت مقطعيك المجانيين', wall_sub: 'قم بالترقية لمواصلة تحويل الفيديوهات الطويلة إلى مقاطع قصيرة.',
      upgrade_title: 'اختر خطتك', upgrade_sub: 'ألغِ في أي وقت. الأسعار بعملتك.',
      billing_month: 'شهري', billing_year: 'سنوي', save20: 'وفّر ~20%',
      per_month: '/شهر', per_year: '/سنة', current_plan: 'الخطة الحالية', choose: 'اختر {plan}', most_popular: 'الأكثر شيوعاً',
      settings_title: 'الإعدادات', set_lang: 'اللغة', set_currency: 'العملة', set_caption: 'نمط الترجمة',
      set_account: 'الحساب', set_plan: 'الخطة', cap_bold: 'عريض (افتراضي)', cap_minimal: 'بسيط', cap_karaoke: 'كلمة بكلمة',
      err_choose_file: 'اختر ملف فيديو أولاً', err_paste_url: 'الصق رابط فيديو أولاً',
      job_started: 'بدأت المهمة — ستظهر مقاطعك بالأسفل قريباً.', err_generic: 'حدث خطأ ما. حاول مجدداً.',
      checkout_soon: 'الدفع لخطة {plan} غير مفعّل بعد — مفاتيح الدفع مطلوبة.', uploaded_video: 'فيديو مرفوع'
    }
  };

  const FX = { USD: 1, INR: 86.5, EUR: 0.92, GBP: 0.79, BRL: 5.4, AED: 3.67 };
  const CUR = {
    USD: { symbol: '$', locale: 'en-US' }, INR: { symbol: '₹', locale: 'en-IN' },
    EUR: { symbol: '€', locale: 'de-DE' }, GBP: { symbol: '£', locale: 'en-GB' },
    BRL: { symbol: 'R$', locale: 'pt-BR' }, AED: { symbol: 'د.إ', locale: 'ar-AE' }
  };

  let lang = localStorage.getItem('sc_lang') || (navigator.language || 'en').slice(0, 2);
  if (!DICT[lang]) lang = 'en';
  let currency = localStorage.getItem('sc_currency') || (lang === 'hi' ? 'INR' : 'USD');
  if (!FX[currency]) currency = 'USD';

  function t(key, vars) {
    let s = (DICT[lang] && DICT[lang][key]) || DICT.en[key] || key;
    if (vars) for (const k in vars) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
    return s;
  }
  function money(usd) {
    const v = usd * (FX[currency] || 1);
    const m = CUR[currency];
    try {
      return new Intl.NumberFormat(m.locale, {
        style: 'currency', currency, maximumFractionDigits: v % 1 === 0 ? 0 : 2
      }).format(v);
    } catch { return m.symbol + Math.round(v); }
  }
  function apply(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    (root || document).querySelectorAll('[data-i18n-ph]').forEach(el => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    document.documentElement.lang = lang;
    document.documentElement.dir = DICT[lang]._dir;
  }
  function setLang(l) { if (DICT[l]) { lang = l; localStorage.setItem('sc_lang', l); apply(); window.dispatchEvent(new Event('i18n')); } }
  function setCurrency(c) { if (FX[c]) { currency = c; localStorage.setItem('sc_currency', c); window.dispatchEvent(new Event('i18n')); } }

  w.I18N = {
    t, money, apply, setLang, setCurrency,
    get lang() { return lang; }, get currency() { return currency; },
    langs: Object.keys(DICT).map(k => ({ code: k, name: DICT[k]._name })),
    currencies: Object.keys(CUR)
  };
})(window);
