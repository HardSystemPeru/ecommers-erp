-- Favoritos: soporte para combos (build_pc_tabla)
-- Ejecutar ANTES de `prisma db push` si se quiere migrar datos primero,
-- o después de que la columna `type` exista.

-- 1) Quitar FK a articles (los combos no viven en articles)
SET @fk := (
  SELECT CONSTRAINT_NAME
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'favorites'
    AND COLUMN_NAME = 'article_id'
    AND REFERENCED_TABLE_NAME = 'articles'
  LIMIT 1
);
SET @sql = IF(@fk IS NOT NULL, CONCAT('ALTER TABLE favorites DROP FOREIGN KEY `', @fk, '`'), 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Agregar columna type
ALTER TABLE favorites
  ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'article' AFTER article_id;

-- 3) Marcar favoritos que son combos (article_id no está en articles pero sí en build_pc_tabla)
UPDATE favorites f
INNER JOIN build_pc_tabla b ON b.id = f.article_id
LEFT JOIN articles a ON a.id = f.article_id
SET f.type = 'combo'
WHERE a.id IS NULL;

-- 4) Unicidad que incluye type (permite mismo id como article y como combo)
ALTER TABLE favorites
  DROP INDEX favorites_client_id_article_id_key,
  ADD UNIQUE KEY favorites_client_article_type_unique (client_id, article_id, type);
