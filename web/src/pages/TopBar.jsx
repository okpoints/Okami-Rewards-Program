import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

export default function TopBar({ user, role }) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="logo">O</div>
        <span className="topbar-title">Okami Rewards</span>
      </div>
      <div className="topbar-right">
        <span>{user.displayName || user.email} ({role || 'pending'})</span>
        <button className="btn btn-ghost" onClick={() => signOut(auth)}>Log out</button>
      </div>
    </div>
  );
}
