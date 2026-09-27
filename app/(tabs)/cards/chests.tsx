import { Screen } from '@/components/quest-ui';
import { QuestBoxes } from '@/components/quest-boxes';
import { InventoryNavigation } from '@/components/wardrobe/inventory-navigation';

export default function Chests() {
  return <Screen title="Inventory" subtitle=""><InventoryNavigation active="chests" /><QuestBoxes /></Screen>;
}
