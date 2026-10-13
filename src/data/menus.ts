import roughAndTumbleMenu from './rough-and-tumble-menu.json';

export type RestaurantMenu = {
  restaurantName: string;
  sections: {
    name: string;
    items: string[];
  }[];
};

export const restaurantMenus = {
  'rough-and-tumble': roughAndTumbleMenu,
} satisfies Record<string, RestaurantMenu>;

export type RestaurantId = keyof typeof restaurantMenus;