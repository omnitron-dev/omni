/**
 * HTTP Netron Client Example
 * Demonstrates HTTP REST transport instead of WebSocket
 */

import { HttpNetronClient } from '@omnitron-dev/aether/netron';

interface ProductService {
  getProduct(id: string): Promise<Product>;
  listProducts(): Promise<Product[]>;
  createProduct(data: any): Promise<Product>;
  deleteProduct(id: string): Promise<void>;
}

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
}

async function main() {
  console.log('=== HTTP Netron Client Example ===\n');

  const client = new HttpNetronClient({
    baseUrl: 'http://localhost:3000',
    timeout: 60000,
    headers: {
      'Authorization': 'Bearer your-api-token',
    },
  });

  try {
    await client.initialize();
    console.log('Client initialized\n');

    const productService = await client.queryInterface<ProductService>('ProductService@1.0.0');

    const products = await productService.listProducts();
    console.log('Products:', products);

    const newProduct = await productService.createProduct({
      name: 'Netron Client SDK',
      price: 49.99,
      stock: 100,
    });
    console.log('Created:', newProduct);

    await productService.deleteProduct(newProduct.id);
    console.log('Deleted product');
  } catch (error: any) {
    console.error('Error:', error.message);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
