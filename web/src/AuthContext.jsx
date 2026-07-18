import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from './firebase';

const AuthContext = createContext(null);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setRole(null);
        setLoading(false);
        return;
      }

      setUser(firebaseUser);
      setLoading(false);

      // Custom claims (the role) are set by a backend function that runs
      // right after signup - there's a short window where the account
      // exists but the role hasn't landed yet. Retry a few times rather
      // than showing "no role" for what's really just a brief delay.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const tokenResult = await firebaseUser.getIdTokenResult(attempt > 0);
        if (tokenResult.claims.role) {
          setRole(tokenResult.claims.role);
          break;
        }
        await wait(1500);
      }

      try {
        await httpsCallable(functions, 'recordLogin')();
      } catch {
        // Non-critical - "last login" just won't update this one time.
      }
    });

    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
