import { supabase } from './supabase-client.js';

// Global function to update UI based on session
export async function updateAuthUI(session) {
    const loginBtn = document.getElementById('nav-login-btn');
    const userMenu = document.getElementById('nav-user-menu');
    const userGreeting = document.getElementById('nav-user-greeting');
    
    // Mobile elements
    const mobileLoginBtn = document.getElementById('mobile-login-btn');
    const mobileSignoutMenu = document.getElementById('mobile-signout-menu');

    if (session) {
        // User is signed in
        if (loginBtn) loginBtn.style.display = 'none';
        if (userMenu) userMenu.style.display = 'block';
        if (mobileLoginBtn) mobileLoginBtn.style.display = 'none';
        if (mobileSignoutMenu) mobileSignoutMenu.style.display = 'block';
        
        if (userGreeting) {
            try {
                const { data: profile, error } = await supabase
                    .from('profiles')
                    .select('full_name, role')
                    .eq('id', session.user.id)
                    .single();
                
                const displayName = profile?.full_name || session.user.user_metadata?.full_name || session.user.email.split('@')[0];
                userGreeting.innerHTML = `hi, ${displayName}`;
                
                // Store role if needed for routing
                if (profile?.role) {
                    sessionStorage.setItem('userRole', profile.role);
                }
            } catch (err) {
                const fallbackName = session.user.user_metadata?.full_name || session.user.email.split('@')[0];
                userGreeting.innerHTML = `hi, ${fallbackName}`;
            }
        }
    } else {
        // User is signed out
        if (loginBtn) loginBtn.style.display = 'flex';
        if (userMenu) userMenu.style.display = 'none';
        if (mobileLoginBtn) mobileLoginBtn.style.display = 'block';
        if (mobileSignoutMenu) mobileSignoutMenu.style.display = 'none';
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
