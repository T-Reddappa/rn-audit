import React, { useState, useEffect, useCallback, useMemo } from "react";
import { View, Text, FlatList, ScrollView, Image, StyleSheet, Pressable } from "react-native";

// A basic React Native component with common patterns
export function ProductList({ products, onSelect }: ProductListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const styles = StyleSheet.create({
    container: { flex: 1 },
    item: { padding: 16 },
    image: { width: 100, height: 100 },
  });

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      onSelect?.(id);
    },
    [onSelect],
  );

  const sortedProducts = useMemo(() => {
    return products.sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  useEffect(() => {
    setIsLoading(true);
    // Simulate data fetch
    const timer = setTimeout(() => setIsLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  const renderItem = ({ item }: { item: Product }) => (
    <Pressable
      onPress={() => handleSelect(item.id)}
      style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}
    >
      <Image source={{ uri: item.image }} style={styles.image} accessibilityLabel={item.name} />
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ fontSize: 16, fontWeight: "600" }}>{item.name}</Text>
        <Text style={{ fontSize: 14, color: "#666", marginLeft: 8 }}>${item.price}</Text>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {isLoading ? (
        <Text>Loading...</Text>
      ) : (
        <FlatList
          data={sortedProducts}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
        />
      )}
    </View>
  );
}

// Types used by the component
interface Product {
  id: string;
  name: string;
  price: number;
  image: string;
}

interface ProductListProps {
  products: Product[];
  onSelect?: (id: string) => void;
}

// A component defined as an arrow function
export const ProductCard = ({ product }: { product: Product }) => {
  return (
    <View style={{ padding: 8, borderRadius: 4 }}>
      <Image source={{ uri: product.image }} accessibilityLabel={product.name} />
      <Text>{product.name}</Text>
      <Text>${product.price}</Text>
    </View>
  );
};

// Default export
export default ProductList;
