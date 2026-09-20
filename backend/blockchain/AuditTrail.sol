// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title AuditTrail
/// @notice Demo contract for an immutable audit log of bank retention
/// actions (churn interventions, complaint resolutions, forecast
/// snapshots). Extends the original ForecastStorage.sol pattern from the
/// Outliers project with a generic record type instead of a single
/// forecast value, so it can back several audit use cases at once.
contract AuditTrail {
    struct Record {
        bytes32 recordHash;
        string recordType;   // e.g. "churn_intervention", "complaint_resolution", "forecast_snapshot"
        string description;
        uint256 timestamp;
        address storedBy;
    }

    Record[] public records;

    event RecordStored(uint256 indexed index, string recordType, bytes32 recordHash, address indexed sender);

    function addRecord(bytes32 recordHash, string calldata recordType, string calldata description) external returns (uint256) {
        records.push(Record({
            recordHash: recordHash,
            recordType: recordType,
            description: description,
            timestamp: block.timestamp,
            storedBy: msg.sender
        }));
        uint256 index = records.length - 1;
        emit RecordStored(index, recordType, recordHash, msg.sender);
        return index;
    }

    function totalRecords() external view returns (uint256) {
        return records.length;
    }

    function getLatestRecord() external view returns (bytes32 recordHash, string memory recordType, string memory description, uint256 timestamp, address storedBy) {
        require(records.length > 0, "No records stored yet");
        Record storage r = records[records.length - 1];
        return (r.recordHash, r.recordType, r.description, r.timestamp, r.storedBy);
    }

    function getRecord(uint256 index) external view returns (bytes32 recordHash, string memory recordType, string memory description, uint256 timestamp, address storedBy) {
        require(index < records.length, "Index out of range");
        Record storage r = records[index];
        return (r.recordHash, r.recordType, r.description, r.timestamp, r.storedBy);
    }
}
