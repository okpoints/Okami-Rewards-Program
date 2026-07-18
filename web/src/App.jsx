import { useState } from 'react';
import { useAuth } from './AuthContext';
import AuthPage, { IdentityCheckStep } from './pages/AuthPage';
import TopBar from './pages/TopBar';
import AssociateDashboard from './pages/AssociateDashboard';
import ManagerDashboard from './pages/ManagerDashboard';

export default function App() {
  const { user, role, loading } = useAuth();
  const [justSignedUp, setJustSignedUp] = useState(null); // holds the full name entered at signup, or null

  if (loading) {
    return <div className="auth-screen"><p style={{ color: 'white' }}>Loading...</p></div>;
  }

  if (!user) {
    return <AuthPage onSignupComplete={(fullName) => setJustSignedUp(fullName)} />;
  }

  if (!role) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1>Setting up your account...</h1>
          <p className="subtitle">This only takes a moment. Try refreshing if it's been more than a minute.</p>
        </div>
      </div>
    );
  }

  // Only associates need the Cortex identity check - admins/managers are
  // recognized straight from the bootstrap allowlist and never earn
  // Cortex points themselves.
  if (justSignedUp !== null && role === 'associate') {
    return (
      <div className="auth-screen">
        <IdentityCheckStep suggestedName={justSignedUp} onDone={() => setJustSignedUp(null)} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopBar user={user} role={role} />
      <div className="main-content">
        {role === 'associate' ? <AssociateDashboard user={user} /> : <ManagerDashboard />}
      </div>
    </div>
  );
}
