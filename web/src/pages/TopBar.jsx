import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

export default function TopBar({ user, role, activeTab, onTabChange }) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="logo">O</div>
        <span className="topbar-title">Okami Rewards</span>
        {role === 'associate' && onTabChange && (
          <nav className="topbar-nav">
            <button
              className={`topbar-nav-link${activeTab === 'dashboard' ? ' active' : ''}`}
              onClick={() => onTabChange('dashboard')}
            >
              My Points Dashboard
            </button>
            <button
              className={`topbar-nav-link${activeTab === 'profile' ? ' active' : ''}`}
              onClick={() => onTabChange('profile')}
            >
              My Profile
            </button>
          </nav>
        )}
      </div>
      <div className="topbar-right">
        <span>{user.displayName || user.email} ({role || 'pending'})</span>
        <button className="btn btn-ghost" onClick={() => signOut(auth)}>Log out</button>
      </div>
    </div>
  );
}
