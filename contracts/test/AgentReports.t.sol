// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentReports} from "../src/AgentReports.sol";

contract AgentReportsTest is Test {
    AgentReports reports;
    address constant OWNER = address(0xA11CE);
    address constant AGENT = address(0xA6E);

    event Report(address indexed owner, address indexed sender, bytes32 indexed ref, bytes envelope);

    function setUp() public {
        reports = new AgentReports();
    }

    function test_post_emits_the_envelope_for_the_owner_with_the_sender() public {
        bytes memory env = hex"71736561";
        vm.expectEmit(true, true, true, true);
        emit Report(OWNER, AGENT, bytes32("tx"), env);
        vm.prank(AGENT);
        reports.post(OWNER, bytes32("tx"), env);
    }

    function test_holds_nothing_and_refuses_value() public {
        (bool ok,) = address(reports).call{value: 1}("");
        assertFalse(ok);
        assertEq(address(reports).balance, 0);
    }

    function test_refuses_empty_oversized_or_ownerless_reports() public {
        vm.expectRevert(AgentReports.EmptyEnvelope.selector);
        reports.post(OWNER, bytes32(0), "");
        vm.expectRevert(AgentReports.ZeroOwner.selector);
        reports.post(address(0), bytes32(0), hex"01");
        bytes memory big = new bytes(24_001);
        vm.expectRevert(abi.encodeWithSelector(AgentReports.EnvelopeTooLarge.selector, 24_001));
        reports.post(OWNER, bytes32(0), big);
    }

    function test_a_realistic_signed_and_sealed_report_fits() public {
        bytes memory env = new bytes(15_000);
        reports.post(OWNER, bytes32("tx"), env);
    }
}
