'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUserRole } from '@/lib/rolesClient';

interface Bin {
  id: string;
  name: string;
  location: string;
  capacity: number;
  currentWaste: number;
  lastEmptied: string;
  status: 'empty' | 'partial' | 'full';
}

interface WasteReport {
  id: string;
  binId: string;
  binName: string;
  amount: number;
  type: 'organic' | 'inorganic' | 'plastic' | 'mixed';
  reportedAt: string;
  reportedBy: string;
  notes?: string;
}

export default function WorkerDashboard() {
  const router = useRouter();
  const { role, loading: roleLoading } = useUserRole();

  const [bins, setBins] = useState<Bin[]>([]);
  const [reports, setReports] = useState<WasteReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedBin, setSelectedBin] = useState<string | null>(null);
  const [wasteAmount, setWasteAmount] = useState('');
  const [wasteType, setWasteType] = useState<'organic' | 'inorganic' | 'plastic' | 'mixed'>('mixed');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Redirect non-workers
  useEffect(() => {
    if (!roleLoading && role && role !== 'worker') {
      router.push('/');
    }
  }, [role, roleLoading, router]);

  const getAuthHeader = useCallback(async () => {
    const user = JSON.parse(localStorage.getItem('canteen_user') || '{}');
    if (user.idToken) {
      return { Authorization: `Bearer ${user.idToken}` };
    }
    return { Authorization: '' };
  }, []);

  // Fetch bins and reports
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const authHeader = await getAuthHeader();

        // Fetch bins
        const binsRes = await fetch('/api/bins', { headers: authHeader });
        if (binsRes.ok) {
          const binsData = await binsRes.json();
          setBins(binsData.bins || []);
        }

        // Fetch waste reports
        const reportsRes = await fetch('/api/waste-reports', { headers: authHeader });
        if (reportsRes.ok) {
          const reportsData = await reportsRes.json();
          setReports(reportsData.reports || []);
        }

        setError('');
      } catch (err) {
        setError('Failed to load waste tracking data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (!roleLoading) {
      fetchData();
    }
  }, [roleLoading, getAuthHeader]);

  // Report waste
  const reportWaste = async () => {
    if (!selectedBin || !wasteAmount) {
      setError('Please select a bin and enter waste amount');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      const authHeader = await getAuthHeader();

      const response = await fetch('/api/waste-reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({
          binId: selectedBin,
          amount: parseFloat(wasteAmount),
          type: wasteType,
          notes,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to report waste');
      }

      // Refresh data
      const authHeaderNew = await getAuthHeader();
      const reportsRes = await fetch('/api/waste-reports', { headers: authHeaderNew });
      if (reportsRes.ok) {
        const reportsData = await reportsRes.json();
        setReports(reportsData.reports || []);
      }

      // Reset form
      setSelectedBin(null);
      setWasteAmount('');
      setWasteType('mixed');
      setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to report waste');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (roleLoading || loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">👷 Waste Tracking</h1>
          <p className="text-gray-600">Monitor bins and report waste</p>
        </div>
        <Link href="/worker" className="text-accent hover:underline">
          ← Worker Hub
        </Link>
      </div>

      {error && (
        <div className="bg-red-500 text-white p-4 rounded mb-8">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Bins Overview */}
        <div className="lg:col-span-2">
          <div className="bg-panel rounded-lg p-6 border border-line mb-8">
            <h2 className="text-xl font-bold mb-6">Waste Bins Status</h2>

            {bins.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No bins available
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {bins.map((bin) => {
                  const fillPercentage = (bin.currentWaste / bin.capacity) * 100;
                  return (
                    <div
                      key={bin.id}
                      className={`p-4 rounded-lg border-2 ${
                        bin.status === 'full'
                          ? 'border-red-500 bg-red-50'
                          : bin.status === 'partial'
                          ? 'border-yellow-500 bg-yellow-50'
                          : 'border-green-500 bg-green-50'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h3 className="font-bold">{bin.name}</h3>
                          <p className="text-sm text-gray-600">{bin.location}</p>
                        </div>
                        <span
                          className={`px-3 py-1 rounded text-sm font-semibold ${
                            bin.status === 'full'
                              ? 'bg-red-200 text-red-800'
                              : bin.status === 'partial'
                              ? 'bg-yellow-200 text-yellow-800'
                              : 'bg-green-200 text-green-800'
                          }`}
                        >
                          {bin.status === 'full' ? '🔴 Full' : bin.status === 'partial' ? '🟡 Partial' : '🟢 Empty'}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full bg-gray-300 rounded-full h-2 mb-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            bin.status === 'full'
                              ? 'bg-red-500'
                              : bin.status === 'partial'
                              ? 'bg-yellow-500'
                              : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(fillPercentage, 100)}%` }}
                        />
                      </div>

                      <div className="text-sm text-gray-600">
                        <p>
                          {bin.currentWaste.toFixed(1)} / {bin.capacity} kg
                          ({fillPercentage.toFixed(0)}% full)
                        </p>
                        <p className="mt-1">
                          Last emptied: {new Date(bin.lastEmptied).toLocaleDateString()}
                        </p>
                      </div>

                      <button
                        onClick={() => setSelectedBin(bin.id)}
                        className={`w-full mt-3 py-2 rounded font-semibold transition ${
                          selectedBin === bin.id
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                        }`}
                      >
                        Report Waste
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Reports */}
          <div className="bg-panel rounded-lg p-6 border border-line">
            <h2 className="text-xl font-bold mb-4">Recent Waste Reports</h2>

            {reports.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No reports yet
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {reports.map((report) => (
                  <div key={report.id} className="flex justify-between items-start p-3 border border-line rounded">
                    <div className="flex-1">
                      <p className="font-semibold">{report.binName}</p>
                      <p className="text-sm text-gray-600">
                        {report.amount} kg • {report.type}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(report.reportedAt).toLocaleDateString()} {new Date(report.reportedAt).toLocaleTimeString()}
                      </p>
                    </div>
                    {report.notes && (
                      <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded ml-4 max-w-xs">
                        {report.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Report Waste Form */}
        <div className="bg-panel rounded-lg p-6 border border-line sticky top-8">
          <h2 className="text-xl font-bold mb-6">Report Waste</h2>

          {!selectedBin ? (
            <div className="text-center py-8 text-gray-500">
              Select a bin to report waste
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block font-semibold mb-2">
                  Bin: {bins.find((b) => b.id === selectedBin)?.name}
                </label>
              </div>

              <div>
                <label className="block font-semibold mb-2">Waste Amount (kg)</label>
                <input
                  type="number"
                  value={wasteAmount}
                  onChange={(e) => setWasteAmount(e.target.value)}
                  placeholder="0.5"
                  step="0.1"
                  min="0"
                  className="w-full p-2 border border-line rounded focus:outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="block font-semibold mb-2">Waste Type</label>
                <select
                  value={wasteType}
                  onChange={(e) => setWasteType(e.target.value as 'organic' | 'inorganic' | 'plastic' | 'mixed')}
                  className="w-full p-2 border border-line rounded focus:outline-none focus:border-accent"
                >
                  <option value="organic">🥗 Organic</option>
                  <option value="inorganic">♻️ Inorganic</option>
                  <option value="plastic">🛍️ Plastic</option>
                  <option value="mixed">🗑️ Mixed</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-2">Notes (Optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="E.g., Container damaged, special handling needed..."
                  className="w-full p-2 border border-line rounded focus:outline-none focus:border-accent"
                  rows={3}
                />
              </div>

              <button
                onClick={reportWaste}
                disabled={submitting}
                className="w-full bg-green-600 text-white py-3 rounded font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Reporting...' : 'Report Waste'}
              </button>

              <button
                onClick={() => setSelectedBin(null)}
                className="w-full bg-gray-200 text-gray-900 py-2 rounded font-semibold hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
