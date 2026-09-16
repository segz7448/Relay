import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const glyphs = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json');
const files=[]; const walk=d=>fs.readdirSync(d,{withFileTypes:true}).forEach(e=>{const p=path.join(d,e.name); e.isDirectory()?walk(p):/\.(js|jsx)$/.test(p)&&files.push(p)}); walk('app'); walk('components');
const bad=[];
for(const file of files){const source=fs.readFileSync(file,'utf8'); for(const re of [/<Ionicons[^>]*\bname=["']([^"']+)["']/gs,/<(?:SettingsRow|HeaderIconButton|ActionButton|Row|PrimaryButton|SecondaryButton)[^>]*\bicon=["']([^"']+)["']/gs]) for(const match of source.matchAll(re)) if(!glyphs[match[1]]) bad.push(`${file}: ${match[1]}`);}
assert.deepEqual(bad,[],`invalid Ionicons names:\n${bad.join('\n')}`);
const root=fs.readFileSync('app/_layout.jsx','utf8'); assert.match(root,/useFonts/); assert.match(root,/Ionicons\.font/); assert.match(root,/maxFontSizeMultiplier: 1\.15/);
const conversation=fs.readFileSync('app/conversation/[id].jsx','utf8'); assert.doesNotMatch(conversation,/`\/bot\/\$\{convo\.id\}`/); assert.match(conversation,/convo\.refId \|\| convo\.id/);
const search=fs.readFileSync('app/search.jsx','utf8'); assert.match(search,/item.photoUrl/); assert.match(search,/`\/contact\/\$\{user\.id\}\?source=directory`/);
const clipboard=fs.readFileSync('app/agent-connection.jsx','utf8'); assert.match(clipboard,/copySecretValue\(AGENT_HOST, "Relay endpoint", false\)/); assert.doesNotMatch(clipboard,/Clipboard\.setStringAsync\(AGENT_HOST\)/);
const theme=fs.readFileSync('theme.js','utf8'); assert.match(theme,/surface: 'rgba\(/); assert.match(theme,/bg: 'rgba\(/);
const backdrop=fs.readFileSync('components/PremiumBackdrop.jsx','utf8'); assert.match(backdrop,/AccessibilityInfo\.isReduceMotionEnabled/); assert.match(backdrop,/Animated\.loop/); assert.match(backdrop,/BlurView/);
const stack=fs.readFileSync('app/_layout.jsx','utf8'); assert.match(stack,/animation: "slide_from_right"/); assert.match(stack,/PremiumBackdrop/);
const tabs=fs.readFileSync('app/(tabs)/_layout.jsx','utf8'); assert.match(tabs,/animation: "fade"/);
console.log(`release regression verifier passed: ${files.length} UI modules, ${Object.keys(glyphs).length} valid Ionicons glyphs, shared glass/motion/reduce-motion system present`);
