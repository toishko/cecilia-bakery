import { supabase } from './supabase-client.js';

// Listen for authentication state changes globally
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN') {
    console.log('Auth State: Session detected (Signed In)', session.user.id);
  } else if (event === 'SIGNED_OUT') {
    console.log('Auth State: No session (Signed Out)');
  } else if (event === 'INITIAL_SESSION') {
    if (session) {
      console.log('Auth State: Initial session detected', session.user.id);
    } else {
      console.log('Auth State: No initial session');
    }
  }
});
