import { supabase } from './supabase-client.js';
window.__supabase = supabase;

// Global function to update UI based on session
export async function updateAuthUI(session) {
    const loginBtn = document.getElementById('nav-login-btn');
    
    // Mobile/hamburger elements
    const mobileLoginBtn = document.getElementById('mobile-login-btn');
    const mobileAccountMenu = document.getElementById('mobile-account-menu');
    const mobileSignoutMenu = document.getElementById('mobile-signout-menu');

    if (session) {
        // User is signed in — hide login, show name + account items in hamburger
        if (loginBtn) loginBtn.style.display = 'none';
        if (mobileLoginBtn) mobileLoginBtn.style.display = 'none';
        if (mobileAccountMenu) mobileAccountMenu.style.display = 'block';
        if (mobileSignoutMenu) mobileSignoutMenu.style.display = 'block';

        // Show user name in navbar
        const navGreeting = document.getElementById('nav-user-greeting');
        const navUserName = document.getElementById('nav-user-name');
        if (navGreeting && navUserName) {
            try {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('full_name')
                    .eq('id', session.user.id)
                    .single();
                const displayName = profile?.full_name || session.user.user_metadata?.full_name || session.user.email.split('@')[0];
                navUserName.textContent = displayName;
            } catch (err) {
                navUserName.textContent = session.user.user_metadata?.full_name || session.user.email.split('@')[0];
            }
            navGreeting.style.display = 'flex';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    } else {
        // User is signed out — show login, hide account items
        if (loginBtn) loginBtn.style.display = 'flex';
        if (mobileLoginBtn) mobileLoginBtn.style.display = 'block';
        if (mobileAccountMenu) mobileAccountMenu.style.display = 'none';
        if (mobileSignoutMenu) mobileSignoutMenu.style.display = 'none';
        const navGreeting = document.getElementById('nav-user-greeting');
        if (navGreeting) navGreeting.style.display = 'none';
    }
}

// Initial check for session
supabase.auth.getSession().then(({ data: { session } }) => {
    updateAuthUI(session);
});

// Listen for authentication state changes globally
supabase.auth.onAuthStateChange(async (event, session) => {
    console.log(`Auth State Change: ${event}`, session?.user?.id);
    updateAuthUI(session);
});

// Global Event Delegation for Sign Out
document.addEventListener('click', async (e) => {
    if (e.target && (e.target.id === 'nav-sign-out-btn' || e.target.id === 'mobile-sign-out-btn')) {
        e.preventDefault();
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error('Error signing out:', error.message);
        } else {
            window.location.href = 'index.html';
        }
    }
});
