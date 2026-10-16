import {
  Boxes, Building2, CalendarDays, ClipboardList, Database, FileText,
  MapPin, Package, ShoppingBag, Truck, UserRound, UsersRound, Wrench,
} from 'lucide-react';

export const OBJECT_ICON_OPTIONS = [
  { key: 'box', label: '通用对象', Icon: Boxes },
  { key: 'package', label: '资产/物品', Icon: Package },
  { key: 'building', label: '组织/机构', Icon: Building2 },
  { key: 'person', label: '人员', Icon: UserRound },
  { key: 'team', label: '团队', Icon: UsersRound },
  { key: 'location', label: '地点', Icon: MapPin },
  { key: 'vehicle', label: '车辆/运输', Icon: Truck },
  { key: 'tool', label: '设备/维修', Icon: Wrench },
  { key: 'document', label: '文档', Icon: FileText },
  { key: 'order', label: '工单/订单', Icon: ClipboardList },
  { key: 'product', label: '产品', Icon: ShoppingBag },
  { key: 'event', label: '事件', Icon: CalendarDays },
  { key: 'database', label: '数据实体', Icon: Database },
];

const legacyIcons = {
  '资': 'package', '部': 'building', '地': 'location', '址': 'location',
  '修': 'tool', '工': 'order', '人': 'person', '组': 'team', '类': 'box', '▦': 'box',
};

export function resolveObjectIcon(value) {
  const key = legacyIcons[value] || value || 'box';
  return OBJECT_ICON_OPTIONS.find((item) => item.key === key) || OBJECT_ICON_OPTIONS[0];
}

export function ObjectTypeIcon({ value, size = 17, strokeWidth = 1.8 }) {
  const { Icon, label } = resolveObjectIcon(value);
  return <Icon size={size} strokeWidth={strokeWidth} aria-label={label} />;
}

export function ObjectIconPicker({ value, onChange }) {
  const selected = resolveObjectIcon(value).key;
  return <div className="object-icon-picker" role="radiogroup" aria-label="对象图标">
    {OBJECT_ICON_OPTIONS.map(({ key, label, Icon }) => <button
      key={key}
      type="button"
      role="radio"
      aria-checked={selected === key}
      className={selected === key ? 'selected' : ''}
      onClick={() => onChange(key)}
      title={label}
    ><Icon size={18} /><span>{label}</span></button>)}
  </div>;
}
