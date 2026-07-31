import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import OkamiLogo from '../components/OkamiLogo';
import NotificationBell from '../components/NotificationBell';

export default function TopBar({ user, role, activeTab, onTabChange }) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <OkamiLogo size={32} />
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
        {(role === 'manager' || role === 'admin') && onTabChange && (
          <nav className="topbar-nav">
            <button
              className={`topbar-nav-link${activeTab !== 'admin' && activeTab !== 'profile' ? ' active' : ''}`}
              onClick={() => onTabChange('controls')}
            >
              Manager Controls
            </button>
            <button
              className={`topbar-nav-link${activeTab === 'admin' ? ' active' : ''}${role === 'admin' ? ' admin-tab' : ''}`}
              onClick={() => onTabChange('admin')}
            >
              {role === 'admin' ? 'Admin panel' : 'Admin'}
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
        <NotificationBell user={user} />
        <span>{user.displayName || user.email} ({role || 'pending'})</span>
        <button className="btn btn-ghost" onClick={() => signOut(auth)}>Log out</button>
      </div>
    </div>
  );
}
