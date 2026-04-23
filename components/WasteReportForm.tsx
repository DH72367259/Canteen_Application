"use client";

import React, { useState, useEffect } from "react";
import type { Bin } from "@/types/models";

export default function WasteReportForm() {
  const [bins, setBins] = useState<Bin[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    binId: "",
    weight: 0,
    notes: "",
    workerId: "worker-1", // placeholder
  });

  useEffect(() => {
    async function loadBins() {
      try {
        const res  = await fetch("/api/bins");
        const data = await res.json();
        setBins(data.bins ?? []);
      } catch (error) {
        console.error("Failed to load bins:", error);
      }
    }
    loadBins();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.binId || formData.weight <= 0) {
      alert("Please select a bin and enter a valid weight");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/waste-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          binId:     formData.binId,
          canteenId: "canteen-1",
          workerId:  formData.workerId,
          weight:    formData.weight,
          notes:     formData.notes,
        }),
      });
      if (!res.ok) throw new Error("Failed to submit report");
      alert("Waste report submitted successfully!");
      setFormData({ binId: "", weight: 0, notes: "", workerId: "worker-1" });
    } catch (error) {
      console.error("Failed to submit report:", error);
      alert("Failed to submit report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6">Report Waste</h2>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Select Bin</label>
        <select
          value={formData.binId}
          onChange={(e) => setFormData({ ...formData, binId: e.target.value })}
          className="w-full border rounded px-3 py-2"
          required
        >
          <option value="">-- Choose a bin --</option>
          {bins.map((bin) => (
            <option key={bin.id} value={bin.id}>
              {bin.type} (ID: {bin.id})
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Weight (kg)</label>
        <input
          type="number"
          step="0.1"
          min="0"
          value={formData.weight}
          onChange={(e) =>
            setFormData({ ...formData, weight: parseFloat(e.target.value) })
          }
          className="w-full border rounded px-3 py-2"
          required
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Notes</label>
        <textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="w-full border rounded px-3 py-2 h-20"
          placeholder="Add any observations..."
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white py-2 rounded font-medium hover:bg-blue-700 disabled:bg-gray-400"
      >
        {loading ? "Submitting..." : "Submit Report"}
      </button>
    </form>
  );
}
