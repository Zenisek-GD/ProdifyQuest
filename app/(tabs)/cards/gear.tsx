import { Screen } from '@/components/quest-ui';
import { EquipmentPanel } from '@/components/equipment-panel';
import { InventoryNavigation } from '@/components/wardrobe/inventory-navigation';

export default function Gear() {
  return <Screen title="Inventory" subtitle=""><InventoryNavigation active="gear" /><EquipmentPanel /></Screen>;
}
