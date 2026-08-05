import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth } from '../firebase';
import PushDeviceToggle from '../components/PushDeviceToggle';
import { formatPoints } from '../formatPoints';

function toDate(value) {
  return value?.toDate ? value.toDate() : new Date(value);
}

export default function ProfilePage({ user }) {
  const [profile, setProfile] = useState(null);
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [photoUrlDraft, setPhotoUrlDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        const data = snap.data();
        setProfile(data || null);
        setPhotoUrlDraft(data?.photoUrl || '');
        setLoadError(data ? '' : `No account record was found for this login (uid: ${user.uid}).`);
      },
      (err) => setLoadError(err.message)
    );
    return unsub;
  }, [user.uid]);

  useEffect(() => {
    if (!profile?.rosterId) {
      setLedgerEntries([]);
      return undefined;
    }
    const unsub = onSnapshot(collection(db, 'roster', profile.rosterId, 'ledger'), (snap) => {
      setLedgerEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [profile?.rosterId]);

  async function handleSaveProfile() {
    setMessage('');
    try {
      await updateDoc(doc(db, 'users', user.uid), { photoUrl: photoUrlDraft.trim() });
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

  async function handleTogglePushPreference(enabled) {
    setMessage('');
    try {
      await updateDoc(doc(db, 'users', user.uid), { 'notificationPreferences.pushEnabled': enabled });
    } catch (err) {
      setMessage(err.message);
    }
  }

  if (loadError) {
    return (
      <div className="card">
        <p className="error-text">Couldn't load your profile: {loadError}</p>
      </div>
    );
  }
  if (!profile) return null;

  const latestLedgerEntry = [...ledgerEntries].sort((a, b) => (b.week || '').localeCompare(a.week || ''))[0];
  const completedBonusTasksCount = profile.completedBonusTasksCount || 0;
  const rescueCompletedCount = profile.rescueCompletedCount || 0;
  const deductionCount = profile.deductionCount || 0;
  const isGoldOrPlatinum = ['Gold', 'Platinum'].includes(profile.currentStanding);

  const badges = [
    rescueCompletedCount > 0 && { icon: '🦸', label: 'Rescue Hero', description: 'Stepped up on a rescue bonus task.' },
    completedBonusTasksCount >= 3 && { icon: '🤝', label: 'Team Player', description: `Completed ${completedBonusTasksCount} bonus tasks.` },
    deductionCount === 0 && ledgerEntries.length >= 4 && { icon: '🛡️', label: 'Reliable', description: 'No attendance deductions on record.' },
    isGoldOrPlatinum && { icon: '⭐', label: 'Gold Standard', description: `Currently ${profile.currentStanding} standing.` },
  ].filter(Boolean);

  const opportunities = [];
  if (latestLedgerEntry?.worstMetric) {
    opportunities.push(`Your most recent area to improve is ${latestLedgerEntry.worstMetric}.`);
  }
  if (!isGoldOrPlatinum) {
    opportunities.push('Reach Gold standing to unlock the rewards marketplace.');
  }

  return (
    <div>
      <div className="card">
        <div className="profile-header">
          <h2>My Rewards Account Profile</h2>
          <button className="btn btn-outline" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Cancel' : 'Edit Profile'}
          </button>
        </div>

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
          <span className="badge badge-pending" style={{ marginTop: 8 }}>{profile.role}</span>
        </div>

        {editing && (
          <div className="field" style={{ marginTop: 16 }}>
            <label>Custom Photo URL</label>
            <input
              type="text"
              placeholder="e.g. https://images.unsplash.com/..."
              value={photoUrlDraft}
              onChange={(e) => setPhotoUrlDraft(e.target.value)}
            />
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={handleSaveProfile}>Save</button>
            <p className="muted" style={{ marginTop: 8 }}>
              Your name comes from your Cortex identity and can't be changed here - ask a manager if it's wrong.
            </p>
            <button className="btn btn-outline" style={{ marginTop: 8 }} onClick={handleResetPassword}>Reset password by email</button>
          </div>
        )}

        {message && <p style={{ marginTop: 12 }}>{message}</p>}
      </div>

      <div className="card">
        <h2>My Performance Badges & Achievements ({badges.length})</h2>
        {badges.length === 0 && <p className="muted">Keep earning points and completing bonus tasks to unlock badges.</p>}
        <div className="badge-grid">
          {badges.map((b) => (
            <div className="achievement-badge" key={b.label}>
              <span className="achievement-icon">{b.icon}</span>
              <div>
                <div className="achievement-label">{b.label}</div>
                <div className="muted">{b.description}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="points-hero" style={{ marginTop: 16 }}>
          <div className="points-hero-stat total">
            <div className="stat-label">Amazon Level</div>
            <div className="stat-value">{profile.currentStanding || 'Unrated'}</div>
          </div>
          <div className="points-hero-stat">
            <div className="stat-label">Points Balance</div>
            <div className="stat-value">{formatPoints(profile.totalPoints)}</div>
          </div>
          {latestLedgerEntry?.bestMetric && (
            <div className="points-hero-stat">
              <div className="stat-label">Strongest Metric</div>
              <div className="stat-value" style={{ fontSize: 18 }}>{latestLedgerEntry.bestMetric}</div>
            </div>
          )}
        </div>
      </div>

      {opportunities.length > 0 && (
        <div className="card">
          <h2>Opportunities to grow</h2>
          {opportunities.map((o) => (
            <p className="progress-callout" key={o} style={{ marginBottom: 8 }}>💡 {o}</p>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Notifications</h2>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={profile.notificationPreferences?.pushEnabled !== false}
            onChange={(e) => handleTogglePushPreference(e.target.checked)}
          />
          Send notifications to my phone (redemption updates, new announcements, point changes)
        </label>
        <p className="muted" style={{ marginBottom: 12 }}>
          Turning this off still shows notifications in the app - you just won't get them on your phone.
        </p>
        <PushDeviceToggle userId={user.uid} />
      </div>
    </div>
  );
}
