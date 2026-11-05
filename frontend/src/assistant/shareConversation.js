const FONT_STACK = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

function plainText(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*\n?/gi, '').replace(/```/g, ''))
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wrap(ctx, text, maxWidth) {
  const lines = [];
  String(text || '').split('\n').forEach((paragraph) => {
    if (!paragraph) { lines.push(''); return; }
    let line = '';
    for (const char of paragraph) {
      const next = line + char;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  });
  return lines;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function buildLayout(messages) {
  const baseWidth = 920;
  const padding = 38;
  const maxBubble = 690;
  const textWidth = maxBubble - 34;
  const measure = document.createElement('canvas').getContext('2d');
  const rows = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message, index, list) => message.text || message.resources?.length || (index > 0 && list[index - 1]?.role === 'user'));
  const firstUser = rows.findIndex((message) => message.role === 'user');
  let selected = firstUser >= 0 ? rows.slice(firstUser) : rows;
  let truncated = false;
  if (selected.length > 12) { selected = selected.slice(-12); truncated = true; }
  const blocks = [];
  let totalText = 0;
  selected.forEach((message) => {
    measure.font = `15px ${FONT_STACK}`;
    const raw = plainText(message.text);
    const allowance = Math.max(500, 2600 - totalText);
    const text = raw.length > allowance ? `${raw.slice(0, allowance)}…` : raw;
    if (text.length < raw.length) truncated = true;
    totalText += text.length;
    const lines = wrap(measure, text, textWidth);
    const resources = message.resources || [];
    const resourceText = resources.length ? `随问题发送：${resources.map((item) => `${item.type === 'object_type' ? '对象' : item.type === 'attribute' ? '属性' : item.type === 'link_type' ? '关系' : '资源'} · ${item.label || item.id}`).join('    ')}` : '';
    const resourceLines = resourceText ? wrap(measure, resourceText, textWidth) : [];
    const scenario = message.scenarioDiscovery || message.scenario_discovery;
    const scenarioText = scenario ? `AI 场景资源包：${scenario.objects?.length || 0} 个对象、${scenario.links?.length || 0} 条关系、${scenario.rules?.length || 0} 条规则、${scenario.actions?.length || 0} 个动作` : '';
    const scenarioLines = scenarioText ? wrap(measure, scenarioText, textWidth) : [];
    const width = Math.min(maxBubble, Math.max(250, ...lines.map((line) => measure.measureText(line).width + 34), ...resourceLines.map((line) => measure.measureText(line).width + 34)));
    const bubbleHeight = lines.length * 26 + resourceLines.length * 20 + scenarioLines.length * 20 + 34;
    blocks.push({ message, lines, resourceLines, scenarioLines, width, bubbleHeight });
  });
  const height = 138 + blocks.reduce((sum, block) => sum + block.bubbleHeight + 54, 0) + 92;
  return { baseWidth, padding, blocks, height, truncated };
}

export async function buildConversationShareImage({ messages, ontologyName, sessionLabel }) {
  if (document.fonts?.ready) await document.fonts.ready;
  const layout = buildLayout(messages || []);
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = layout.baseWidth * scale;
  canvas.height = layout.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#f4f8fc';
  ctx.fillRect(0, 0, layout.baseWidth, layout.height);

  // Header
  const headerGradient = ctx.createLinearGradient(0, 0, layout.baseWidth, 138);
  headerGradient.addColorStop(0, '#173b63');
  headerGradient.addColorStop(1, '#2f71a7');
  ctx.fillStyle = headerGradient;
  ctx.fillRect(0, 0, layout.baseWidth, 138);
  ctx.fillStyle = 'rgba(255,255,255,.14)';
  roundRect(ctx, 38, 30, 54, 54, 14); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.font = `700 22px ${FONT_STACK}`; ctx.fillText('AI', 53, 44);
  ctx.font = `700 23px ${FONT_STACK}`; ctx.fillText('本体智能 · 对话记录', 108, 30);
  ctx.font = `13px ${FONT_STACK}`; ctx.fillStyle = 'rgba(255,255,255,.78)';
  ctx.fillText(`${ontologyName || '当前本体'} · ${sessionLabel || '对话'}`, 108, 62);
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  roundRect(ctx, 108, 88, 150, 24, 12); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.font = `11px ${FONT_STACK}`;
  ctx.fillText('DeepSeek Flash · 真实对话', 121, 94);

  let y = 164;
  layout.blocks.forEach((block, index) => {
    const user = block.message.role === 'user';
    const x = user ? layout.baseWidth - layout.padding - block.width : layout.padding;
    const nameY = y;
    ctx.font = `600 12px ${FONT_STACK}`;
    ctx.fillStyle = user ? '#4c6680' : '#2f5d80';
    if (user) {
      ctx.textAlign = 'right'; ctx.fillText('我', layout.baseWidth - layout.padding, nameY); ctx.textAlign = 'left';
    } else {
      ctx.fillText('本体智能', layout.padding, nameY);
    }
    y += 21;
    ctx.fillStyle = user ? '#2169d7' : '#ffffff';
    ctx.strokeStyle = user ? '#2169d7' : '#dbe7f1';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, block.width, block.bubbleHeight, 13); ctx.fill(); if (!user) ctx.stroke();
    let textY = y + 17;
    ctx.font = `15px ${FONT_STACK}`;
    if (block.resourceLines.length) {
      ctx.fillStyle = user ? 'rgba(255,255,255,.78)' : '#68849a';
      ctx.font = `11px ${FONT_STACK}`;
      block.resourceLines.forEach((line) => { ctx.fillText(line, x + 17, textY); textY += 20; });
      ctx.font = `15px ${FONT_STACK}`;
    }
    ctx.fillStyle = user ? '#ffffff' : '#29475f';
    block.lines.forEach((line) => { ctx.fillText(line, x + 17, textY); textY += 26; });
    if (block.scenarioLines.length) {
      ctx.fillStyle = user ? 'rgba(255,255,255,.82)' : '#5d7890';
      ctx.font = `11px ${FONT_STACK}`;
      block.scenarioLines.forEach((line) => { ctx.fillText(line, x + 17, textY); textY += 20; });
    }
    y += block.bubbleHeight + 28;
  });

  // Footer
  const footerY = layout.height - 62;
  ctx.strokeStyle = '#dbe7f1'; ctx.beginPath(); ctx.moveTo(38, footerY - 16); ctx.lineTo(layout.baseWidth - 38, footerY - 16); ctx.stroke();
  ctx.fillStyle = '#8a9eae'; ctx.font = `11px ${FONT_STACK}`;
  ctx.fillText(`本体智能生成 · ${new Date().toLocaleString('zh-CN')}`, 38, footerY);
  ctx.textAlign = 'right';
  ctx.fillText(layout.truncated ? '已截取最近对话 · 仅供评审' : '仅供评审 · 不包含模型原始思考', layout.baseWidth - 38, footerY);
  ctx.textAlign = 'left';
  return { dataUrl: canvas.toDataURL('image/png'), width: layout.baseWidth * scale, height: layout.height * scale, truncated: layout.truncated };
}
