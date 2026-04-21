'use client';

import React from 'react';
import { useAuth } from '@/lib/auth-context';

export default function SuperAdminDashboard() {
  const { user, logout } = useAuth();

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1>Super Admin Panel</h1>
        <button onClick={logout} style={styles.logoutButton}>Logout</button>
      </div>
      <div style={styles.content}>
        <p>Welcome, Platform Admin {user?.email}</p>
        <div style={styles.adminGrid}>
          <div style={styles.adminCard}>
            <h3>Platform Analytics</h3>
            <p>View system-wide metrics and insights</p>
          </div>
          <div style={styles.adminCard}>
            <h3>Manage Canteens</h3>
            <p>Add, enable/disable canteens</p>
          </div>
          <div style={styles.adminCard}>
            <h3>User Management</h3>
            <p>Manage all users and roles</p>
          </div>
          <div style={styles.adminCard}>
            <h3>Complaints & Escalations</h3>
            <p>Handle user and vendor issues</p>
          </div>
          <div style={styles.adminCard}>
            <h3>Vendor Settlements</h3>
            <p>Manage payouts and wallet</p>
          </div>
          <div style={styles.adminCard}>
            <h3>Reward System Config</h3>
            <p>Configure loyalty rules and settings</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: '1200px', margin: '0 auto', padding: '20px' },
  header: { display: 'flex', justifyContent: 'space-between', marginBottom: '30px' },
  logoutButton: { padding: '8px 16px', backgroundColor: '#dc2626', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  content: { padding: '20px' },
  adminGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginTop: '20px' },
  adminCard: { padding: '20px', backgroundColor: '#f3e8ff', borderRadius: '8px', border: '1px solid #e9d5ff' },
};
