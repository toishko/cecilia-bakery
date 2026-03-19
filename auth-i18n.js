/* Shared Auth Logic (i18n & Theme) */
const i18nAuth = {
    'en': {
        'themeLight': 'Light', 'themeDark': 'Dark', 'back': 'Return to Bakery'
    },
    'es': {
        'themeLight': 'Claro', 'themeDark': 'Oscuro', 'back': 'Regresar a la Panadería'
    }
};

let currentLang = 'en';

function setAuthLang(l) {
    currentLang = l;
    try { localStorage.setItem('lang', l); } catch(e) {}
    document.documentElement.lang = l;
    const btnEn = document.getElementById('btn-en');
    const btnEs = document.getElementById('btn-es');
    if(btnEn && btnEs) {
        btnEn.classList.toggle('active', l === 'en');
        btnEs.classList.toggle('active', l === 'es');
    }
    
    document.querySelectorAll('[data-en]').forEach(el => {
        const val = el.getAttribute('data-' + l);
        if(!val) return;
        if(val.includes('<') || el.tagName === 'A' || el.tagName === 'BUTTON') el.innerHTML = val;
        else if (el.tagName === 'INPUT' && el.type !== 'submit') el.placeholder = val;
        else el.innerHTML = val; if (typeof lucide !== 'undefined') lucide.createIcons();
    });

    const themeLabel = document.getElementById('theme-label');
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if(themeLabel) themeLabel.textContent = currentTheme === 'dark' ? i18nAuth[l].themeLight : i18nAuth[l].themeDark;
    
    const backBtn = document.getElementById('back-text');
    if(backBtn) backBtn.textContent = i18nAuth[l].back;
}

function toggleAuthTheme() {
    const root = document.documentElement;
    const isDark = root.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    root.setAttribute('data-theme', newTheme);
    
    // Attempt saving to localStorage to sync with main site
    try { localStorage.setItem('theme', newTheme); } catch(e){}
    
    const icon = document.getElementById('theme-icon');
    const label = document.getElementById('theme-label');
    if (icon && label) {
        icon.innerHTML = newTheme === 'dark' ? `<i data-lucide='sun' class='icon'></i>` : `<i data-lucide='moon' class='icon'></i>`; if (typeof lucide !== 'undefined') lucide.createIcons();
        label.textContent = newTheme === 'dark' ? i18nAuth[currentLang].themeLight : i18nAuth[currentLang].themeDark;
    }
}

// Load default preferences
window.addEventListener('DOMContentLoaded', () => {
    let savedTheme = 'light';
    try { 
        const _saved = localStorage.getItem('theme');
        if(_saved) {
            savedTheme = _saved;
        } else {
            localStorage.setItem('theme', 'light');
        }
    } catch(e){}
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    const icon = document.getElementById('theme-icon');
    if (icon) icon.innerHTML = savedTheme === 'dark' ? `<i data-lucide='sun' class='icon'></i>` : `<i data-lucide='moon' class='icon'></i>`; if (typeof lucide !== 'undefined') lucide.createIcons();
    
    /* Restore saved language preference */
    let initialLang = 'en';
    try {
        const savedLang = localStorage.getItem('lang');
        if (savedLang && (savedLang === 'en' || savedLang === 'es')) initialLang = savedLang;
    } catch(e) {}
    setAuthLang(initialLang);

    // Attach Toggle UI for Login/Signup if elements exist
    const authCard = document.getElementById('authCard');
    const tSignup = document.getElementById('toggleSignup');
    const tLogin = document.getElementById('toggleLogin');
    if(tSignup) tSignup.addEventListener('click', (e) => { e.preventDefault(); authCard.classList.add('is-signup'); });
    if(tLogin) tLogin.addEventListener('click', (e) => { e.preventDefault(); authCard.classList.remove('is-signup'); });
});
