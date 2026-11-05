import { Download, LoaderCircle, Share2 } from 'lucide-react';
import Modal from '../components/Modal';

export default function ConversationShareModal({ open, image, busy, truncated, onClose, onDownload }) {
  if (!open) return null;
  return <Modal wide title="分享对话为图片" subtitle="图片包含当前多轮对话、随问题发送的资源和 AI 回答；不包含模型原始思考。" onClose={onClose} footer={<><span className="share-modal-note">{image ? `${image.width} × ${image.height}px${truncated ? ' · 已截取最近对话' : ''}` : ''}</span><button type="button" className="btn secondary" onClick={onClose}>关闭</button><button type="button" className="btn primary" disabled={!image || busy} onClick={onDownload}><Download size={14} /> 下载 PNG</button></>}>
    <div className="conversation-share-preview">
      {busy ? <div className="conversation-share-loading"><LoaderCircle className="spin" size={22} /><strong>正在生成分享图片…</strong><span>会把当前对话按消息顺序排版为一张长图。</span></div> : image ? <img src={image.dataUrl} alt="本体智能对话分享图" /> : <div className="conversation-share-loading"><Share2 size={24} /><strong>暂无可分享内容</strong><span>先完成一轮对话再分享。</span></div>}
    </div>
  </Modal>;
}
