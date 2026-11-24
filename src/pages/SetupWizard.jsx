import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, AlertCircle, HardDrive, Wifi, Bell, User, Lock, ArrowLeft, ArrowRight } from 'lucide-react';
import api from '../utils/apiClient';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import GlassCard from '../components/glass/GlassCard';
import { GlassInput } from '../components/glass/GlassInput';
import GlassButton from '../components/glass/GlassButton';
import GlassBadge from '../components/glass/GlassBadge';

const steps = [
  { id: 'welcome', title: 'Welcome', icon: '👋' },
  { id: 'root-admin', title: 'Root Admin', icon: User },
  { id: 'backup', title: 'Backup', icon: HardDrive },
  { id: 'preferences', title: 'Preferences', icon: Bell },
  { id: 'done', title: 'Complete', icon: Check },
];

export default function SetupWizard() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    // Step 1: Root admin
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    // Step 2: Backup
    backupPath: '',
    backupPathValid: false,
    backupPathTesting: false,
    // Step 3: Preferences
    wsEnabled: true,
    browserPopupEnabled: true,
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const validateStep = () => {
    switch (currentStep) {
      case 1: // Root admin
        if (!formData.name || !formData.email || !formData.password || !formData.confirmPassword) {
          setError('All fields are required');
          return false;
        }
        if (formData.password !== formData.confirmPassword) {
          setError('Passwords do not match');
          return false;
        }
        if (formData.password.length < 8) {
          setError('Password must be at least 8 characters');
          return false;
        }
        if (!formData.email.includes('@')) {
          setError('Invalid email format');
          return false;
        }
        return true;
      case 2: // Backup
        if (!formData.backupPath) {
          setError('Backup path is required');
          return false;
        }
        if (!formData.backupPathValid) {
          setError('Please test the backup path first');
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  const handleNext = async () => {
    if (!validateStep()) return;
    setLoading(true);
    setError('');

    try {
      switch (currentStep) {
        case 1: { // Root admin
          const { ok, error: err } = await api.post('/api/setup/root-admin', {
            name: formData.name,
            email: formData.email,
            password: formData.password,
          });
          if (!ok) throw new Error(err || 'Failed to create root admin');
          break;
        }
        case 2: { // Backup
          const { ok, error: err } = await api.post('/api/setup/backup', {
            path: formData.backupPath,
          });
          if (!ok) throw new Error(err || 'Failed to save backup path');
          break;
        }
        case 3: { // Preferences
          const { ok, error: err } = await api.post('/api/setup/preferences', {
            wsEnabled: formData.wsEnabled,
            browserPopupEnabled: formData.browserPopupEnabled,
          });
          if (!ok) throw new Error(err || 'Failed to save preferences');
          break;
        }
        case 4: { // Done
          const { ok, error: err } = await api.post('/api/setup/complete');
          if (!ok) throw new Error(err || 'Failed to complete setup');
          // Auto-login
          const { ok: loginOk, data } = await api.post('/api/auth/login', {
            email: formData.email,
            password: formData.password,
          });
          if (loginOk && data?.token) {
            // Single-source auth write: AuthContext.login owns the
            // studioUser/studioToken keys AND the React state — a direct
            // localStorage write here would leave the context stale.
            login(data.user, data.token);
            navigate('/');
          }
          return;
        }
      }
      setCurrentStep(prev => prev + 1);
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setCurrentStep(prev => prev - 1);
    setError('');
  };

  const testBackupPath = async () => {
    if (!formData.backupPath) {
      setError('Enter a backup path first');
      return;
    }
    setFormData(prev => ({ ...prev, backupPathTesting: true }));
    try {
      const { ok, error: err } = await api.post('/api/setup/backup/test', {
        path: formData.backupPath,
      });
      if (ok) {
        setFormData(prev => ({ ...prev, backupPathValid: true, backupPathTesting: false }));
      } else {
        setFormData(prev => ({ ...prev, backupPathValid: false, backupPathTesting: false }));
        setError(err || 'Path test failed');
      }
    } catch (err) {
      setFormData(prev => ({ ...prev, backupPathValid: false, backupPathTesting: false }));
      setError(err.message || 'Path test failed');
    }
  };

  const StepIcon = ({ step, isActive, isComplete }) => {
    const icon = steps[step].icon;
    if (isComplete) return <Check className="w-5 h-5 text-[color:var(--status-success)]" />;
    if (typeof icon === 'string') return <span className="text-2xl">{icon}</span>;
    return <icon className={`w-5 h-5 ${isActive ? 'text-[color:var(--ui-indigo)]' : 'tt-muted'}`} />;
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[color:var(--ui-indigo-darkest)]/50 via-[color:var(--ui-purple-darkest)]/30 to-[color:var(--ui-indigo-darkest)]/50">
      <div className="w-full max-w-2xl">
        {/* Progress indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between relative">
            <div className="absolute top-1/2 left-0 right-0 h-1 bg-white/10 -z-10" />
            {steps.map((step, idx) => (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="flex flex-col items-center relative z-10"
              >
                <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
                  idx < currentStep ? 'bg-[color:var(--status-success-strong)]/20 border-[color:var(--status-success)]' :
                  idx === currentStep ? 'bg-[color:var(--ui-indigo-strong)]/20 border-[color:var(--ui-indigo)]' :
                  'bg-white/5 border-white/10'
                }`}>
                  <StepIcon step={idx} isActive={idx === currentStep} isComplete={idx < currentStep} />
                </div>
                <span className={`mt-2 text-xs font-medium ${idx <= currentStep ? 'tt' : 'tt-muted'}`}>
                  {step.title}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: currentStep > 0 ? 50 : -50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: currentStep > 0 ? -50 : 50 }}
            transition={{ duration: 0.3 }}
          >
            <GlassCard className="p-8">
              <h2 className="text-2xl font-bold tt mb-2">{steps[currentStep].title}</h2>
              <p className="tt-sec mb-6">
                {currentStep === 0 && 'Welcome to IT Asset Manager. This wizard will guide you through the initial setup.'}
                {currentStep === 1 && 'Create the root administrator account. This account has full access to all features.'}
                {currentStep === 2 && 'Configure the backup destination. Use a UNC path (e.g., \\\\NAS\\backups) or local directory.'}
                {currentStep === 3 && 'Set your notification preferences.'}
                {currentStep === 4 && 'Setup is complete! You will be logged in automatically.'}
              </p>

              {error && (
                <div className="mb-4 glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold flex items-center gap-2">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}

              {/* Step 0: Welcome */}
              {currentStep === 0 && (
                <div className="space-y-4">
                  <GlassCard className="p-6 text-center border-[color:var(--status-success-strong)]/30 bg-[color:var(--status-success-strong)]/10">
                    <div className="text-4xl mb-3">📦</div>
                    <h3 className="text-lg font-semibold tt mb-2">IT Asset Manager</h3>
                    <p className="tt-sec">Studio/property IT asset tracking with real-time notifications, backup, and helpdesk.</p>
                  </GlassCard>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {[
                      { icon: '🔔', title: 'Real-time Alerts', desc: 'WebSocket notifications with polling fallback' },
                      { icon: '💾', title: 'On-demand Backup', desc: 'Complete snapshots to UNC paths' },
                      { icon: '🎫', title: 'Helpdesk', desc: 'Ticket system with asset linking' },
                    ].map((item, i) => (
                      <GlassCard key={i} className="p-4 text-center">
                        <div className="text-3xl mb-2">{item.icon}</div>
                        <h4 className="font-medium tt mb-1">{item.title}</h4>
                        <p className="text-xs tt-sec">{item.desc}</p>
                      </GlassCard>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 1: Root Admin */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  <GlassInput
                    label="Full Name"
                    value={formData.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder="John Doe"
                    icon={<User className="w-4 h-4" />}
                  />
                  <GlassInput
                    label="Email Address"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    placeholder="admin@studio.com"
                    icon={<User className="w-4 h-4" />}
                  />
                  <GlassInput
                    label="Password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => handleChange('password', e.target.value)}
                    placeholder="••••••••"
                    icon={<Lock className="w-4 h-4" />}
                  />
                  <GlassInput
                    label="Confirm Password"
                    type="password"
                    value={formData.confirmPassword}
                    onChange={(e) => handleChange('confirmPassword', e.target.value)}
                    placeholder="••••••••"
                    icon={<Lock className="w-4 h-4" />}
                  />
                  <div className="text-xs tt-label mt-2">
                    Password must be at least 8 characters. This account will have root admin privileges.
                  </div>
                </div>
              )}

              {/* Step 2: Backup */}
              {currentStep === 2 && (
                <div className="space-y-4">
                  <GlassInput
                    label="Backup Path (UNC or local)"
                    value={formData.backupPath}
                    onChange={(e) => handleChange('backupPath', e.target.value)}
                    placeholder="\\\\NAS\\studio\\backups or D:\\backups"
                    icon={<HardDrive className="w-4 h-4" />}
                  />
                  <div className="flex gap-3">
                    <GlassButton
                      variant={formData.backupPathValid ? 'default' : 'secondary'}
                      onClick={testBackupPath}
                      disabled={formData.backupPathTesting || !formData.backupPath}
                    >
                      {formData.backupPathTesting ? 'Testing...' : 'Test Connection'}
                    </GlassButton>
                    {formData.backupPathValid && (
                      <GlassBadge variant="success">Path validated</GlassBadge>
                    )}
                  </div>
                  <div className="text-xs tt-label space-y-1">
                    <p>Examples:</p>
                    <p className="font-mono">\\\\NAS\\studio\\backups</p>
                    <p className="font-mono">D:\\backups</p>
                    <p className="font-mono">/mnt/backups</p>
                  </div>
                </div>
              )}

              {/* Step 3: Preferences */}
              {currentStep === 3 && (
                <div className="space-y-6">
                  <div>
                    <h4 className="font-medium tt mb-4 flex items-center gap-2">
                      <Wifi className="w-5 h-5 text-[color:var(--ui-indigo)]" />
                      Real-time Notifications
                    </h4>
                    <label className="flex items-center justify-between cursor-pointer p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                      <div>
                        <p className="font-medium tt">WebSocket Live Updates</p>
                        <p className="text-xs tt-label">Receive instant notifications without refreshing</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={formData.wsEnabled}
                        onChange={(e) => handleChange('wsEnabled', e.target.checked)}
                        className="w-5 h-5 accent-[color:var(--ui-indigo-strong)]"
                      />
                    </label>
                  </div>
                  <div>
                    <h4 className="font-medium tt mb-4 flex items-center gap-2">
                      <Bell className="w-5 h-5 text-[color:var(--status-warning)]" />
                      In-App Alerts
                    </h4>
                    <label className="flex items-center justify-between cursor-pointer p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                      <div>
                        <p className="font-medium tt">Browser Popup Banner</p>
                        <p className="text-xs tt-label">Show toast banner when critical alerts arrive</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={formData.browserPopupEnabled}
                        onChange={(e) => handleChange('browserPopupEnabled', e.target.checked)}
                        className="w-5 h-5 accent-[color:var(--status-warning-strong)]"
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* Step 4: Done */}
              {currentStep === 4 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-8"
                >
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-[color:var(--status-success-strong)]/20 border-2 border-[color:var(--status-success)] flex items-center justify-center">
                    <Check className="w-10 h-10 text-[color:var(--status-success)]" />
                  </div>
                  <h3 className="text-xl font-bold tt mb-2">Setup Complete!</h3>
                  <p className="tt-sec mb-6">Your IT Asset Manager instance is ready. Logging you in...</p>
                  <div className="flex justify-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[color:var(--ui-indigo)] animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-[color:var(--ui-indigo)] animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-[color:var(--ui-indigo)] animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </motion.div>
              )}
            </GlassCard>

            {/* Navigation buttons */}
            <div className="flex justify-between mt-6">
              {currentStep > 0 && (
                <GlassButton variant="secondary" onClick={handleBack} disabled={loading}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </GlassButton>
              )}
              {currentStep < steps.length - 1 && (
                <GlassButton onClick={handleNext} disabled={loading} className="ml-auto">
                  Next
                  <ArrowRight className="w-4 h-4 ml-2" />
                </GlassButton>
              )}
              {currentStep === steps.length - 1 && loading && (
                <GlassButton disabled className="ml-auto">
                  Completing...
                </GlassButton>
              )}
              {currentStep === steps.length - 1 && !loading && (
                <GlassButton onClick={handleNext} className="ml-auto">
                  Complete Setup
                  <ArrowRight className="w-4 h-4 ml-2" />
                </GlassButton>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}