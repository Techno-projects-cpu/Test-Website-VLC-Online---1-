# Watch Party — Step 1 (Rooms + Chat + Reactions)

This is the first working piece: private rooms, live chat, participant list, and floating emoji reactions. No video sync yet — that's next.

## How to put this online (Render)

1. Go to https://render.com and sign up (free).
2. Put this folder into a GitHub repository (create a new repo, upload these files).
3. In Render, click **New +** → **Web Service**.
4. Connect your GitHub repo.
5. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
6. Click **Create Web Service**. Render will give you a live URL like `https://your-app-name.onrender.com`.

That's it — that URL is your working website.

## How to test it

1. Open the URL Render gives you.
2. Click **Create Room** → enter your name.
3. Copy the invite link (button in the room) and open it in another browser tab, or send it to a friend.
4. Join with a different name in the other tab.
5. Try:
   - Sending chat messages back and forth
   - Clicking the emoji reaction buttons — they should float up on both screens
   - Seeing each other in the "In this room" list

## Note on the free Render tier
Free services "sleep" after 15 minutes of no traffic, and take ~30-50 seconds to wake up on the next visit. Totally fine for testing with friends — just expect a short delay if nobody's used it in a while.

## What's next
Once you confirm this works, the next step is the video piece: host picks a file, it streams to everyone in the room via WebRTC, synced play/pause, separate volume per person.
