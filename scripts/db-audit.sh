#!/bin/bash
# DB Audit — Schema, columns, indexes, consistency check
MYSQL="mysql-l7kwyegn8qmocpfweql206ep"
CMD="docker exec $MYSQL bash -c"

echo "═══════════════════════════════════════"
echo " GRUDGE STUDIO — DATABASE AUDIT"
echo " $(date)"
echo "═══════════════════════════════════════"

echo ""
echo "=== 1. TABLES ==="
$CMD 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" grudge_game -e "SHOW TABLES;"' 2>/dev/null

echo ""
echo "=== 2. USERS TABLE — ALL COLUMNS ==="
$CMD 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" grudge_game -e "DESCRIBE users;"' 2>/dev/null

echo ""
echo "=== 3. ROW COUNTS ==="
for table in users characters crews crew_members missions wallet_index; do
  COUNT=$($CMD "mysql -u root -p\"\$MYSQL_ROOT_PASSWORD\" grudge_game -sN -e \"SELECT COUNT(*) FROM $table;\"" 2>/dev/null)
  echo "   $table: $COUNT rows"
done

echo ""
echo "=== 4. INDEXES ON USERS ==="
$CMD 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" grudge_game -e "SHOW INDEX FROM users;"' 2>/dev/null

echo ""
echo "=== 5. MISSING COLUMNS CHECK ==="
REQUIRED="grudge_id username email password_hash display_name avatar_url phone discord_id discord_tag google_id github_id wallet_address server_wallet_address server_wallet_index puter_id puter_uuid puter_username faction race class gold gbux_balance is_active is_banned ban_reason is_guest"
EXISTING=$($CMD 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" grudge_game -sN -e "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_name=\"users\" AND table_schema=\"grudge_game\";"' 2>/dev/null)
MISSING=0
for col in $REQUIRED; do
  if echo "$EXISTING" | grep -qw "$col"; then
    true
  else
    echo "   MISSING: $col"
    MISSING=$((MISSING + 1))
  fi
done
if [ "$MISSING" -eq 0 ]; then
  echo "   ALL $( echo $REQUIRED | wc -w) required columns present"
fi

echo ""
echo "=== 6. CHARACTERS TABLE ==="
$CMD 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" grudge_game -e "DESCRIBE characters;"' 2>/dev/null

echo ""
echo "=== 7. FOREIGN KEY CHECKS ==="
$CMD 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" grudge_game -e "SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=\"grudge_game\" AND REFERENCED_TABLE_NAME IS NOT NULL;"' 2>/dev/null

echo ""
echo "=== 8. ENGINE & CHARSET ==="
$CMD 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" grudge_game -e "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA=\"grudge_game\";"' 2>/dev/null

echo ""
echo "=== 9. SERVICE CONNECTIVITY ==="
docker exec grudge-id-l7kwyegn8qmocpfweql206ep wget -qO- http://localhost:3001/health 2>/dev/null && echo " grudge-id: OK" || echo " grudge-id: DOWN"
docker exec game-api-l7kwyegn8qmocpfweql206ep wget -qO- http://localhost:3003/health 2>/dev/null && echo " game-api: OK" || echo " game-api: DOWN"

echo ""
echo "═══════════════════════════════════════"
echo " AUDIT COMPLETE"
echo "═══════════════════════════════════════"
