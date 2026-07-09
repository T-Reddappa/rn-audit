const Example = () => (
  <FlatList data={items} renderItem={({ item }) => <ProductCard item={item} />} />
);
