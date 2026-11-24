# Multi-AI Studio (Vercel version)

Browser me chalta hai. Files tumhare computer ke folder me rehti hain (Chrome ya Edge chahiye).

## Deploy
1. Is folder ko GitHub repo me daalo (repo me pehle ek README hona chahiye, khali repo nahi).
2. vercel.com > Add New > Project > repo import karo. Framework: Other.
3. Deploy se pehle Environment Variables daalo:
   - ACCESS_PASSWORD (apna mazboot password)
   - ANTHROPIC_API_KEY (Gemini/OpenAI chahiye to GEMINI_API_KEY, OPENAI_API_KEY bhi)
4. Deploy karo. Link kholo > Open Folder > message bhejo. Pehli baar password poochega.

## Use
- Auto Save neeche status bar me on/off hota hai.
- "Git" button se code GitHub par push hota hai (fine-grained token, Contents: Read and write).
- "Run Preview" folder ki index.html chalata hai.

## Limits
- AI terminal commands nahi chala sakta (npm, python wagairah). Uske liye local-version use karo.
- Ek model jawab 300 second (vercel.json) ke andar aana chahiye. Agar deploy me maxDuration ka error aaye to vercel.json me 300 ki jagah 60 kar do. Effort "Extra/Max" par jawab dheere aate hain.
- ACCESS_PASSWORD kisi ko mat batao, API ka kharcha tumhare account par jata hai.
