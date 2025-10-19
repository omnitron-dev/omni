use anyhow::Result;
use meridian::storage::SurrealDBStorage;
use std::path::PathBuf;
use surrealdb::sql::Value;

#[tokio::main]
async fn main() -> Result<()> {
    let db_path = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("meridian")
        .join("db");

    println!("Connecting to: {}", db_path.display());
    let storage = SurrealDBStorage::new(&db_path).await?;
    let db = storage.db();

    // Query total symbols
    let mut response = db.query("SELECT count() FROM code_symbol GROUP ALL").await?;
    let result: Option<Value> = response.take(0)?;
    println!("Total symbols: {:?}", result);

    // Query first 3 symbols
    let mut response = db.query("SELECT * FROM code_symbol LIMIT 3").await?;
    let result: Vec<Value> = response.take(0)?;
    println!("\nFirst 3 symbols:");
    for (i, val) in result.iter().enumerate() {
        println!("{}: {:#?}", i + 1, val);
    }

    // Check if metadata exists
    let mut response = db.query("SELECT metadata FROM code_symbol WHERE metadata IS NOT NONE LIMIT 1").await?;
    let result: Vec<Value> = response.take(0)?;
    println!("\nSample metadata:");
    for val in result.iter() {
        println!("{:#?}", val);
    }

    Ok(())
}
