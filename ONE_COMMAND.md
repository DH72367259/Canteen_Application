# QUICKEST WAY TO DEPLOY

Just copy and run this in your Mac Terminal:

```bash
npm install -g firebase-tools && cd ~/Canteen && npm install && firebase experiments:enable webframeworks --project canteen-dashboard-cfeb9 && npm run build && npm run firebase:deploy:canteen:hosting
```

One command. That's it.

After it finishes, go to: https://canteen-dashboard-cfeb9.web.app

Done.
