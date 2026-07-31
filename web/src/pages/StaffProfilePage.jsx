import { useEffect, useState } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth } from '../firebase';

const BASE_PRIVILEGES = [
  'Approve or deny driver reward redemptions',
  'Approve or deny bonus task and Area of Highest Need completions',
  'Directly adjust a driver\'s point balance (with a required reason)',
  'Manage the reward catalog',
  'Manage the driver roster and confirm signup identity matches',
  'Trigger a manual Cortex/Google Drive points sync',
];

const ADMIN_ONLY_PRIVILEGES = [
  'View the full activity/audit log',
  'Promote or demote roles, and delegate permissions to managers',
];

const DELEGATED_PRIVILEGE_LABELS = {
  viewActivityLog: 'View the activity/audit log (delegated)',
  manageManagerPermissions: 'Manage other managers\' delegated permissions (delegated)',
};

export default function StaffProfilePage({ user, role }) {
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ fullName: '', photoUrl: '' });
  const [message, setMessage] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.data();
      setProfile(data);
      setDraft({ fullName: data?.fullName || '', photoUrl: data?.photoUrl || '' });
    });
    return unsub;
  }, [user.uid]);

  async function handleSave() {
    setMessage('');
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        fullName: draft.fullName.trim(),
        photoUrl: draft.photoUrl.trim(),
      });
      setMessage('Profile updated.');
      setEditing(false);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleResetPassword() {
    setMessage('');
    try {
      await sendPasswordResetEmail(auth, user.email);
      setMessage('Password reset email sent - check your inbox (and spam/junk folder).');
    } catch (err) {
      setMessage(err.message);
    }
  }

  if (!profile) return null;

  const privileges = [
    ...BASE_PRIVILEGES,
    ...(role === 'admin' ? ADMIN_ONLY_PRIVILEGES : []),
    ...Object.entries(DELEGATED_PRIVILEGE_LABELS)
      .filter(([key]) => role === 'manager' && profile.permissions?.[key])
      .map(([, label]) => label),
  ];

  return (
    <div>
      <div className="card">
        <div className="profile-summary">
          <div className="profile-avatar">
            {profile.photoUrl ? (
              <img src={profile.photoUrl} alt={profile.fullName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
            ) : (
              <span>{(profile.fullName || profile.email || '?').charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="profile-name">{profile.fullName || 'Unnamed'}</div>
          <div className="muted">{profile.email}</div>
          <span className="badge badge-pending" style={{ marginTop: 8 }}>{role === 'admin' ? 'Administrator' : 'Manager'}</span>
        </div>

        <div className="card" style={{ margin: 0, boxShadow: 'none' }}>
          <h2>System management privileges</h2>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
            {privileges.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="profile-header">
          <h2>Profile configuration settings</h2>
          <button className="btn btn-outline" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Cancel' : 'Edit Profile'}
          </button>
        </div>

        {editing ? (
          <>
            <div className="field" style={{ marginTop: 12 }}>
              <label>Profile name</label>
              <input value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} />
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label>Custom Photo URL</label>
              <input
                placeholder="e.g. https://images.unsplash.com/..."
                value={draft.photoUrl}
                onChange={(e) => setDraft({ ...draft, photoUrl: e.target.value })}
              />
            </div>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={handleSave}>Save</button>
            <button className="btn btn-outline" style={{ marginTop: 12, marginLeft: 8 }} onClick={handleResetPassword}>
              Reset password by email
            </button>
          </>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>Email address stays fixed to your login - contact another admin if it needs to change.</p>
        )}

        {message && <p style={{ marginTop: 12 }}>{message}</p>}
      </div>
    </div>
  );
}
