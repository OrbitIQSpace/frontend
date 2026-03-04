import React, { useState } from 'react';
import axios from '../api';
import { useAuth } from '@clerk/clerk-react';

const AddSatellite = ({ onSatelliteAdded }) => {
  const [noradId, setNoradId]   = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus]     = useState(null); // 'success' | 'error' | null
  const [message, setMessage]   = useState('');

  const { getToken } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!noradId.trim()) return;

    setIsLoading(true);
    setStatus(null);
    setMessage('');

    try {
      const token = await getToken();
      await axios.post(
        '/add-satellite',
        { norad_id: noradId.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setStatus('success');
      setMessage(`NORAD ${noradId.trim()} added to fleet.`);
      setNoradId('');
      if (onSatelliteAdded) onSatelliteAdded();
    } catch (err) {
      setStatus('error');
      setMessage(err.response?.data?.error || err.message || 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const isDisabled = isLoading || !noradId.trim();

  return (
    <div
      className="w-full"
      style={{ fontFamily: '"JetBrains Mono", "Fira Code", monospace' }}
    >
      <div className="space-y-3">

        {/* Input */}
        <div className="relative">
          <input
            type="text"
            placeholder="NORAD ID  —  e.g. 25544"
            value={noradId}
            onChange={(e) => {
              setNoradId(e.target.value);
              setStatus(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && !isDisabled && handleSubmit(e)}
            disabled={isLoading}
            className="w-full px-4 py-3 rounded-lg text-sm text-white outline-none transition-all font-mono"
            style={{
              background: 'rgba(2,6,23,0.9)',
              border: status === 'error'
                ? '1px solid rgba(239,68,68,0.5)'
                : status === 'success'
                  ? '1px solid rgba(52,211,153,0.4)'
                  : '1px solid rgba(34,211,238,0.2)',
              caretColor: '#22d3ee',
            }}
            onFocus={e => {
              if (!status) e.target.style.border = '1px solid rgba(34,211,238,0.5)';
            }}
            onBlur={e => {
              if (!status) e.target.style.border = '1px solid rgba(34,211,238,0.2)';
            }}
          />

          {/* Spinner inside input when loading */}
          {isLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg
                className="animate-spin h-4 w-4"
                style={{ color: '#22d3ee' }}
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </div>
          )}
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={isDisabled}
          className="w-full py-2.5 rounded-lg text-[10px] tracking-[0.25em] uppercase font-mono font-bold transition-all"
          style={isDisabled ? {
            background: 'rgba(15,23,42,0.6)',
            border: '1px solid rgba(30,41,59,0.6)',
            color: '#1e3a5f',
            cursor: 'not-allowed',
          } : {
            background: 'rgba(8,145,178,0.2)',
            border: '1px solid rgba(34,211,238,0.35)',
            color: '#22d3ee',
            cursor: 'pointer',
          }}
          onMouseEnter={e => {
            if (!isDisabled) e.currentTarget.style.background = 'rgba(8,145,178,0.35)';
          }}
          onMouseLeave={e => {
            if (!isDisabled) e.currentTarget.style.background = 'rgba(8,145,178,0.2)';
          }}
        >
          {isLoading ? 'Fetching TLE…' : '+ Add to Fleet'}
        </button>

        {/* Inline status message — no alert() */}
        {status && (
          <p
            className="text-[9px] tracking-[0.18em] uppercase font-mono text-center pt-1"
            style={{ color: status === 'success' ? '#34d399' : '#f87171' }}
          >
            {status === 'success' ? '✓ ' : '✕ '}
            {message}
          </p>
        )}

      </div>
    </div>
  );
};

export default AddSatellite;