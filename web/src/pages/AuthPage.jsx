import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../firebase';

const findRosterCandidates = httpsCallable(functions, 'findRosterCandidates');
const requestIdentityLink = httpsCallable(functions, 'requestIdentityLink');

function Logo() {
  return <div className="logo">O</div>;
}

// After a brand-new driver signs up, we try to match them against the
// Cortex roster so their point history gets linked instead of starting at
// zero. Self-attestation alone never links the account - a manager still
// has to confirm it (see roster.js on the backend). App.jsx renders this
// directly after a fresh signup, since by then the user is already
// authenticated and AuthPage itself would have already unmounted.
export function IdentityCheckStep({ suggestedName, onDone }) {
  const [name, setName] = useState(suggestedName);
  const [candidates, setCandidates] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSearch(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await findRosterCandidates({ enteredName: name });
      setCandidates(res.data.candidates);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(rosterId) {
    setBusy(true);
    setError('');
    try {
      await requestIdentityLink({ rosterId: rosterId || null, enteredName: name });
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="auth-card">
        <h1>You're almost set!</h1>
        <p className="subtitle">
          A manager or admin will confirm your identity shortly so your point history can be linked.
          You can use your dashboard now - it'll update automatically once that's confirmed.
        </p>
        <button className="btn btn-primary" onClick={onDone}>Continue to dashboard</button>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <h1>One last step</h1>
      <p className="subtitle">
        Let's check if you already have points from Cortex under a different name format.
      </p>
      {!candidates && (
        <form onSubmit={handleSearch}>
          <div className="field">
            <label htmlFor="fullName">Your full name</label>
            <input id="fullName" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Searching...' : 'Check'}
          </button>
        </form>
      )}
      {candidates && candidates.length > 0 && (
        <div>
          <p className="muted">Is one of these you?</p>
          {candidates.map((c) => (
            <div key={c.rosterId} className="list-row">
              <span>{c.fullName}</span>
              <button className="btn btn-outline" disabled={busy} onClick={() => handleConfirm(c.rosterId)}>
                Yes, that's me
              </button>
            </div>
          ))}
          <button className="toggle-link" style={{ marginTop: 12 }} disabled={busy} onClick={() => handleConfirm(null)}>
            None of these are me
          </button>
        </div>
      )}
      {candidates && candidates.length === 0 && (
        <div>
          <p className="muted">No matches found - a manager will look into it.</p>
          <button className="btn btn-primary" disabled={busy} onClick={() => handleConfirm(null)}>
            Continue
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

export default function AuthPage({ onSignupComplete }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [alreadyHasAccount, setAlreadyHasAccount] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setAlreadyHasAccount(false);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: fullName });
        onSignupComplete(fullName);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        setAlreadyHasAccount(true);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    if (!email) {
      setError('Enter your email above first, then click "Forgot password?"');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-hero">
        <div className="auth-hero-title">
          <span role="img" aria-hidden="true">🚚</span> Okami Rewards Program
        </div>
        <p className="auth-hero-tagline">
          Turn your excellent performance into <span className="accent-text">amazing rewards</span>
        </p>
      </div>
      <div className="auth-card">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <Logo />
        </div>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="field">
              <label htmlFor="fullName">Full name</label>
              <input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-field">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>
          {mode === 'login' && (
            <div style={{ textAlign: 'right', marginBottom: 14, marginTop: -6 }}>
              <button type="button" className="toggle-link" onClick={handleForgotPassword} disabled={busy}>
                Forgot password?
              </button>
            </div>
          )}
          {resetSent && (
            <p className="muted" style={{ marginBottom: 14 }}>
              Check your email for a link to reset your password - don't forget to check your spam/junk folder too.
            </p>
          )}
          {alreadyHasAccount && (
            <p className="muted" style={{ marginBottom: 14 }}>
              Looks like there's already an account with this email.{' '}
              <button
                type="button"
                className="toggle-link"
                onClick={() => {
                  setMode('login');
                  setAlreadyHasAccount(false);
                  setError('');
                }}
              >
                Log in instead
              </button>
              , or use "Forgot password?" if you don't remember it.
            </p>
          )}
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16, textAlign: 'center' }}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            className="toggle-link"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setResetSent(false);
              setAlreadyHasAccount(false);
              setError('');
            }}
          >
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </div>
    </div>
  );
}
