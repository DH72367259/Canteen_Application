# Deployment Checklist & Guide

## ✅ Code Pushed to GitHub
```
Latest commits pushed to origin/main:
✅ aed664f - Database cleanup guide
✅ b819775 - Pro subscription logic docs
✅ b3482df - Cleanup script
✅ 5dfaa33 - Fix E2E test failures
```

## 🚀 Deployment Status

### Step 1: Monitor Railway Build
1. Go to: https://railway.app/workspace/projects
2. Select your Canteen Application project
3. Click on the "Deployments" tab
4. Watch the build progress:
   ```
   Building... → Building complete → Deploying... → Deployed ✅
   ```

### Step 2: Build Process
Railway will automatically:
1. Pull latest code from GitHub (main branch)
2. Install dependencies (`npm install`)
3. Build Next.js app (`npm run build`)
4. Run health check against `/login` endpoint
5. Start the application on assigned port

**Expected build time**: 3-5 minutes

### Step 3: Verify Deployment
After build completes, you'll see:
```
✅ Build successful
✅ Deployment started
✅ Health check passed
✅ Application is live
```

Your app URL will be at: `https://canteen-[random].railway.app`

## 📋 Post-Deployment Checklist

### Environment Variables ✅
Verify in Railway dashboard under "Variables":
```
NEXT_PUBLIC_SUPABASE_URL        ✅ Set
NEXT_PUBLIC_SUPABASE_ANON_KEY   ✅ Set
SUPABASE_SERVICE_ROLE_KEY       ✅ Set (production key)
RAZORPAY_KEY_ID                 ✅ Set (if using real Razorpay)
RAZORPAY_KEY_SECRET             ✅ Set (if using real Razorpay)
NODE_ENV                        ✅ production
```

### Database Connection ✅
```
PostgreSQL should be connected via:
DATABASE_URL (auto-set by Railway if using Railway PostgreSQL)
OR
NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```

### Production Configuration ✅
```
✅ Next.js Production Mode
✅ Standalone build enabled (.next/standalone)
✅ Health check path: /login (responds in <2s)
✅ Restart policy: ON_FAILURE
✅ Max retries: 3
```

## 🔍 Testing Production Deployment

### 1. Health Check
```bash
curl https://canteen-[random].railway.app/login
# Should return 200 (or redirect to auth page)
```

### 2. API Health
```bash
curl https://canteen-[random].railway.app/api/health
# Should return: { status: "ok" }
```

### 3. Login Test
1. Visit: `https://canteen-[random].railway.app/login`
2. Login with whitelist account:
   - Email: `admin@noqx.test`
   - Password: `Admin@12345`
3. Should redirect to dashboard

### 4. Database Connection
1. Login to admin dashboard
2. Go to Admin → Users or any database-dependent page
3. Should load data from Supabase production database

### 5. Pro Subscription Flow (Manual Test)
1. Login as `canteen1@noqx.test` (canteen admin)
2. View orders → should be empty after cleanup
3. View earnings → should show ₹0 (no orders)
4. Logout, login as student (new user)
5. Create order → should charge ₹4 convenience fee
6. Go to Pro section → purchase Pro subscription
7. Create another order → should charge ₹0 convenience fee

## 📊 Monitoring & Logs

### View Logs in Railway
1. Dashboard → Select Project
2. Click "Logs" tab
3. Filter by:
   - `Build logs` (deploy status)
   - `Deployment logs` (runtime errors)
   - `Container logs` (application output)

### Watch for These Errors
```
❌ ECONNREFUSED (database not connected)
   → Check DATABASE_URL / SUPABASE_URL in variables

❌ Module not found
   → Missing dependency in package.json

❌ Health check failed
   → /login endpoint not responding
   → Database query timing out

❌ Out of memory
   → Application using too much RAM
   → Upgrade Railway plan or optimize code
```

## 🎯 Performance Monitoring

### Expected Response Times (After Deployment)
```
Homepage (GET /):         <500ms
Login (POST /api/auth):   <1s
Order placement (POST):   <2s
Earnings report (GET):    <3s
```

### Monitor in Railway Dashboard
1. Deployments tab → click latest deployment
2. View metrics:
   - CPU usage (should be <20% average)
   - Memory usage (should be <60%)
   - Network I/O
   - HTTP requests

### Database Performance
1. Connect to Supabase dashboard
2. View query performance in "Extensions" → "Insights"
3. Identify slow queries:
   - Orders queries
   - Subscriptions queries
   - Earnings calculations

## 🔧 Troubleshooting Deployment

### Issue: Build Failed
**Check**:
1. `npm run build` works locally
2. All environment variables are set
3. No TypeScript errors
4. Dependencies are correct in package.json

**Solution**:
```bash
# Test locally
npm install
npm run build
npm run start
```

### Issue: Health Check Failed
**Check**:
1. `/login` endpoint is responding
2. Database connection is working
3. Timeout isn't set too low (current: 120s)

**Solution**:
```bash
# Test locally
curl http://localhost:3000/login
```

### Issue: 502 Bad Gateway
**Cause**: Application crashed after deploy
**Check**:
1. View container logs in Railway
2. Look for database connection errors
3. Check for memory leaks

**Solution**:
1. Restart deployment in Railway dashboard
2. Check DATABASE_URL / SUPABASE connection
3. If memory issue: upgrade Railway plan

### Issue: Database Connection Refused
**Check**:
1. SUPABASE_URL is correct
2. SUPABASE_SERVICE_ROLE_KEY is correct (not anon key!)
3. Supabase project is running
4. Network allows connection (usually not an issue)

**Solution**:
```bash
# Test connection locally
curl -X POST https://YOUR_SUPABASE_URL/rest/v1/profiles \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
# Should return: no auth error
```

## 📈 Scaling for 20,000 Users

After deployment, if you see high resource usage:

### Upgrade to Pro Plan
```
Current (Hobby):  0.5 vCPU, 512MB RAM → Insufficient
Pro Plan:         2 vCPU, 2GB RAM → Good for 20K users
Pro+ Plan:        4 vCPU, 4GB RAM → Great for 50K+ users
```

### Add Caching Layer
```
Install Redis on Railway:
1. Dashboard → Add Service → Redis
2. Set REDIS_URL in variables
3. Enable caching in Next.js
```

### Enable Database Replication
```
Supabase → Settings → Replication
→ Create read replicas for analytics queries
→ Reduces main DB load
```

## 🎉 Post-Deployment Steps

1. **Clean Database** (if needed):
   ```bash
   node scripts/cleanup-complete.mjs
   ```

2. **Run E2E Tests Against Production** (Optional):
   ```bash
   # Update APP_BASE_URL in .env.test
   APP_BASE_URL=https://canteen-[random].railway.app npm run test:e2e:full
   ```

3. **Monitor for 24 Hours**:
   - Watch logs for errors
   - Monitor resource usage
   - Test with real users if possible

4. **Set Up Alerts** (Railway Pro):
   - High memory usage
   - High CPU usage
   - Deployment failures
   - Health check failures

## 📞 Support

### Railway Support
- Docs: https://docs.railway.app
- Status: https://railway-status.up.railway.app
- Chat: https://railway.app (bottom right)

### Supabase Support
- Docs: https://supabase.com/docs
- Status: https://status.supabase.com
- Chat: https://supabase.com/docs/support

### Your App Issues
- Check logs in Railway dashboard
- Verify environment variables
- Test locally with same config
- Review GitHub commits for recent changes

## ✅ Final Checklist Before Production

- [ ] All environment variables set in Railway
- [ ] Database URL is correct (Supabase production)
- [ ] Razorpay credentials set (test or production)
- [ ] Health check path responds quickly
- [ ] Logs show no errors during startup
- [ ] Login works with whitelist accounts
- [ ] Orders can be placed and stored
- [ ] Pro subscriptions can be purchased
- [ ] Earnings reports show correct data
- [ ] Database cleanup script works
- [ ] E2E tests pass (optional, but recommended)

---

## Deployment Complete! 🚀

Your Canteen Application is now live on Railway!

**Your App URL**: https://canteen-[random].railway.app

**Dashboard**: https://railway.app/workspace/projects

**Next**: Monitor for 24 hours, then enable Pro plan if seeing resource constraints.
